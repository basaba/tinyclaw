<#
.SYNOPSIS
    Build an action plan for the caller's active Azure DevOps PRs in
    Azure-Kusto-Service.

.DESCRIPTION
    For each active PR returned by the ADO API, this script computes:
      - PendingReviewers : reviewers whose vote (or required-reviewer policy)
                           is still blocking approval. Includes uniqueName so
                           the workflow can email them.
      - OnlyPopMissing   : true when the PR is fully approved and the only
                           outstanding required policy is "Proof Of Presence".
      - ExpiredBuilds    : build policies named "Linux" or "devCM" (matched by
                           substring on displayName) whose status is "expired"
                           OR whose evaluation context points at a stale
                           source commit. These are the builds the workflow
                           will re-queue via PATCH on the policy evaluation.

    Output is a single JSON object on stdout:

      {
        "actions": [ <one entry per PR with the fields above> ],
        "digest" : "<markdown summary suitable for an email body>"
      }

    The workflow uses `actions` for deterministic side-effects and `digest`
    as the email/approval body.

.PARAMETER Org
    Azure DevOps organisation URL. Defaults to https://dev.azure.com/msazure.

.PARAMETER Project
    Project name. Defaults to "One".

.PARAMETER Repository
    Repository name. Defaults to "Azure-Kusto-Service".

.PARAMETER OutFile
    Optional path to write the JSON to instead of stdout.
#>
[CmdletBinding()]
param(
    [string] $Org        = 'https://dev.azure.com/msazure',
    [string] $Project    = 'One',
    [string] $Repository = 'Azure-Kusto-Service',
    [string] $OutFile
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "Required command 'az' is not on PATH."
}

# Well-known IDs for One / Azure-Kusto-Service.
$projectId = 'b32aa71e-8ed2-41b2-9d77-5bc261222004'

$token = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
if (-not $token) { throw "Failed to acquire ADO access token. Run 'az login' first." }
$headers = @{ Authorization = "Bearer $token" }

# --- Fetch the caller's active PRs -----------------------------------------
$prsRaw = az repos pr list `
    --org $Org `
    --project $Project `
    --repository $Repository `
    --creator '@me' `
    --status active `
    --output json 2>$null
if (-not $prsRaw) { throw "az repos pr list returned nothing. Run 'az login' first." }
$prs = $prsRaw | ConvertFrom-Json

function Get-PolicyEvaluations {
    param([int] $PrId)
    Add-Type -AssemblyName System.Web
    $artifactId = "vstfs:///CodeReview/CodeReviewId/$projectId/$PrId"
    $encoded    = [System.Web.HttpUtility]::UrlEncode($artifactId)
    $uri        = "$Org/$projectId/_apis/policy/evaluations?artifactId=$encoded&api-version=7.0-preview.1"
    return (Invoke-RestMethod -Uri $uri -Headers $headers).value
}

function Get-PullRequestFull {
    param([int] $PrId)
    return Invoke-RestMethod `
        -Uri "$Org/$projectId/_apis/git/pullrequests/$PrId`?api-version=7.0" `
        -Headers $headers
}

$cleanName = {
    param($n)
    if (-not $n) { return $n }
    return ($n -replace '\[One\]\\','' -replace '\[TEAM FOUNDATION\]\\','')
}

$results = foreach ($pr in $prs) {
    $prId   = $pr.pullRequestId
    $title  = $pr.title
    $url    = "https://msazure.visualstudio.com/One/_git/$Repository/pullrequest/$prId"

    try {
        $full   = Get-PullRequestFull -PrId $prId
        $evals  = Get-PolicyEvaluations -PrId $prId

        $reviewersById = @{}
        foreach ($r in $full.reviewers) { $reviewersById[$r.id] = $r }

        # ---- Reviewer policies (only blocking ones gate completion) --------
        $reviewerPolicies = $evals | Where-Object {
            $_.configuration.isBlocking -and
            $_.configuration.type.displayName -in @('Required reviewers','Minimum number of reviewers')
        }

        $pendingReviewers = @()
        foreach ($p in $reviewerPolicies) {
            if ($p.status -eq 'approved') { continue }
            if ($p.configuration.type.displayName -eq 'Required reviewers') {
                foreach ($id in $p.configuration.settings.requiredReviewerIds) {
                    if ($reviewersById.ContainsKey($id)) {
                        $rev = $reviewersById[$id]
                        # Skip reviewers who already voted approved / approved with suggestions.
                        if ($rev.vote -ge 5) { continue }
                        $pendingReviewers += [pscustomobject]@{
                            DisplayName = & $cleanName $rev.displayName
                            UniqueName  = $rev.uniqueName
                            Vote        = $rev.vote
                        }
                    } else {
                        $pendingReviewers += [pscustomobject]@{
                            DisplayName = $id
                            UniqueName  = $null
                            Vote        = 0
                        }
                    }
                }
            } else {
                # Minimum-reviewers policy is unmet but not pinned to a specific person.
                $pendingReviewers += [pscustomobject]@{
                    DisplayName = '(needs another approval on latest iteration)'
                    UniqueName  = $null
                    Vote        = 0
                }
            }
        }

        $rejected = @()
        foreach ($r in $full.reviewers) {
            if ($r.vote -eq -10) { $rejected += "$(& $cleanName $r.displayName) Rejected" }
            elseif ($r.vote -eq -5) { $rejected += "$(& $cleanName $r.displayName) Waiting" }
        }

        $isApproved = ($rejected.Count -eq 0) -and
                      ($reviewerPolicies.Count -gt 0) -and
                      ($pendingReviewers.Count -eq 0)

        # ---- Other blocking non-build, non-reviewer policies ---------------
        $otherPolicies = foreach ($p in $evals) {
            if ($p.configuration.isBlocking -and
                $p.configuration.type.displayName -notin @('Required reviewers','Minimum number of reviewers','Build')) {
                [pscustomobject]@{
                    Name   = $p.configuration.type.displayName
                    Status = $p.status
                }
            }
        }

        $popUnmet = $otherPolicies | Where-Object {
            $_.Name -match 'Proof Of Presence' -and $_.Status -ne 'approved'
        }
        $otherUnmetCount = ($otherPolicies | Where-Object {
            $_.Name -notmatch 'Proof Of Presence' -and $_.Status -ne 'approved'
        }).Count

        # ---- Build evaluations: detect stale / expired Linux + devCM -------
        $headSha = $full.lastMergeSourceCommit.commitId
        $buildEvals = $evals | Where-Object { $_.configuration.type.displayName -eq 'Build' }

        $expiredBuilds = foreach ($b in $buildEvals) {
            $name = $b.configuration.settings.displayName
            if (-not $name) { continue }
            # We only care about Linux + devCM here per the user's request.
            $isTarget = ($name -match '(?i)Linux') -or ($name -match '(?i)devCM')
            if (-not $isTarget) { continue }

            $isExpired = $false

            if ($b.status -match '(?i)expired') { $isExpired = $true }

            # Some tenants surface expiration via context fields rather than
            # the top-level status — guard for both shapes.
            if (-not $isExpired -and $b.context) {
                if ($b.context.isExpired -eq $true)        { $isExpired = $true }
                elseif ($b.context.expirationDate)         { $isExpired = $true }
                elseif ($b.context.lastMergeSourceCommit -and
                        $headSha -and
                        $b.context.lastMergeSourceCommit -ne $headSha) {
                    # Build evaluated against an older iteration → stale.
                    $isExpired = $true
                }
            }

            if (-not $isExpired) { continue }

            [pscustomobject]@{
                Name         = $name
                EvaluationId = $b.evaluationId
                Status       = $b.status
            }
        }
        $expiredBuilds = @($expiredBuilds)

        $onlyPopMissing = $isApproved -and ($popUnmet.Count -gt 0) -and ($otherUnmetCount -eq 0)

        [pscustomobject]@{
            Id               = $prId
            Title            = $title
            Url              = $url
            Approved         = $isApproved
            Rejected         = ($rejected.Count -gt 0)
            RejectedReason   = ($rejected -join '; ')
            OnlyPopMissing   = $onlyPopMissing
            PendingReviewers = @($pendingReviewers)
            ExpiredBuilds    = $expiredBuilds
        }
    } catch {
        [pscustomobject]@{
            Id               = $prId
            Title            = $title
            Url              = $url
            Error            = $_.Exception.Message
            PendingReviewers = @()
            ExpiredBuilds    = @()
        }
    }
}

$results = @($results)

# --- Build a markdown digest summarising what the workflow will do ---------
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("# PR action plan")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("Repository: **$Repository** &nbsp;·&nbsp; PRs: **$($results.Count)**")
[void]$sb.AppendLine("")

$popPrs       = @($results | Where-Object { $_.OnlyPopMissing })
$reviewerPrs  = @($results | Where-Object { $_.PendingReviewers.Count -gt 0 -and -not $_.OnlyPopMissing -and -not $_.Rejected })
$requeuePrs   = @($results | Where-Object { $_.ExpiredBuilds.Count -gt 0 })
$rejectedPrs  = @($results | Where-Object { $_.Rejected })
$errorPrs     = @($results | Where-Object { $_.Error })

[void]$sb.AppendLine("## ✅ Approved — only Proof Of Presence missing  ($($popPrs.Count))")
if ($popPrs.Count -eq 0) { [void]$sb.AppendLine("_None._") }
foreach ($p in $popPrs) {
    [void]$sb.AppendLine("- [#$($p.Id)]($($p.Url)) — $($p.Title)")
}
[void]$sb.AppendLine("")

[void]$sb.AppendLine("## ⏳ Waiting on reviewers  ($($reviewerPrs.Count))")
if ($reviewerPrs.Count -eq 0) { [void]$sb.AppendLine("_None._") }
foreach ($p in $reviewerPrs) {
    $names = ($p.PendingReviewers | ForEach-Object { $_.DisplayName }) -join ', '
    [void]$sb.AppendLine("- [#$($p.Id)]($($p.Url)) — $($p.Title)")
    [void]$sb.AppendLine("  - Waiting on: $names")
}
[void]$sb.AppendLine("")

[void]$sb.AppendLine("## 🔁 Builds to re-queue (Linux / devCM, Expired)  ($($requeuePrs.Count))")
if ($requeuePrs.Count -eq 0) { [void]$sb.AppendLine("_None._") }
foreach ($p in $requeuePrs) {
    $bn = ($p.ExpiredBuilds | ForEach-Object { $_.Name }) -join ', '
    [void]$sb.AppendLine("- [#$($p.Id)]($($p.Url)) — $($p.Title)")
    [void]$sb.AppendLine("  - Re-queue: $bn")
}
[void]$sb.AppendLine("")

if ($rejectedPrs.Count -gt 0) {
    [void]$sb.AppendLine("## ❌ Rejected (no auto-action taken)  ($($rejectedPrs.Count))")
    foreach ($p in $rejectedPrs) {
        [void]$sb.AppendLine("- [#$($p.Id)]($($p.Url)) — $($p.Title) — $($p.RejectedReason)")
    }
    [void]$sb.AppendLine("")
}

if ($errorPrs.Count -gt 0) {
    [void]$sb.AppendLine("## ⚠️ Errors  ($($errorPrs.Count))")
    foreach ($p in $errorPrs) {
        [void]$sb.AppendLine("- [#$($p.Id)]($($p.Url)) — $($p.Error)")
    }
    [void]$sb.AppendLine("")
}

# Flat list of build re-queues so the workflow can iterate without nesting.
$requeues = foreach ($p in $requeuePrs) {
    foreach ($b in $p.ExpiredBuilds) {
        [pscustomobject]@{
            PrId         = $p.Id
            PrTitle      = $p.Title
            PrUrl        = $p.Url
            Name         = $b.Name
            EvaluationId = $b.EvaluationId
        }
    }
}
$requeues = @($requeues)

$hasActions = ($popPrs.Count + $reviewerPrs.Count + $requeues.Count) -gt 0

$payload = [pscustomobject]@{
    org         = $Org
    project     = $Project
    actions     = $results
    requeues    = $requeues
    hasActions  = $hasActions
    digest      = $sb.ToString()
}

$json = $payload | ConvertTo-Json -Depth 8
if ($OutFile) { $json | Out-File -FilePath $OutFile -Encoding utf8 } else { $json }
