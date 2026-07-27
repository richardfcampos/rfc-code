---
name: pr-feedback
description: >
  Address PR review comments end-to-end: fetch comments from a GitHub pull request,
  evaluate which ones need code changes, implement the fixes, commit, push, and reply
  to each comment on the PR explaining what was done. Use this skill whenever the user
  wants to handle PR feedback, address review comments, fix PR issues, respond to
  reviewer suggestions, or says things like "address the PR comments", "fix the review
  feedback", "handle PR #123 comments", or pastes a GitHub PR URL and asks you to
  act on the feedback. Also trigger when the user mentions "PR comments", "review
  comments", "reviewer feedback", or "code review suggestions" in the context of
  making changes.
---

# PR Feedback — Automated Review Comment Handler

Read PR comments, implement the requested changes, commit, push, and reply.

## Workflow

### Step 1: Identify the PR

Determine the PR from context:
- If the user provides a PR URL (e.g., `https://github.com/owner/repo/pull/123`), extract owner, repo, and PR number.
- If the user provides just a number (e.g., `#408` or `408`), detect the repo from the current git remote.
- If the user says nothing specific, use the current branch's open PR.

```bash
# Detect repo from current directory.
gh repo view --json nameWithOwner --jq '.nameWithOwner'

# Find PR for current branch.
gh pr view --json number,url --jq '{number, url}'
```

### Step 2: Fetch all comments

Fetch both inline review comments and issue-level comments. Filter out bot accounts and already-resolved threads to focus on human feedback that still needs attention.

```bash
# Inline review comments (code-level feedback).
gh api repos/{owner}/{repo}/pulls/{number}/comments \
  --jq '.[] | select(.user.type != "Bot") | {id, body, path, line, original_line, in_reply_to_id, user: .user.login}'

# Issue-level comments (general PR discussion).
gh api repos/{owner}/{repo}/issues/{number}/comments \
  --jq '.[] | select(.user.type != "Bot") | {id, body, user: .user.login}'

# Review summaries (for context on requested changes).
gh api repos/{owner}/{repo}/pulls/{number}/reviews \
  --jq '.[] | select(.state == "CHANGES_REQUESTED" or .state == "COMMENTED") | select(.user.type != "Bot") | {id, body, state, user: .user.login}'
```

### Step 3: Categorize each comment

For each comment, determine if it is:

1. **Actionable** — Requests a concrete code change (bug fix, refactor, naming, style, missing logic, security fix). These get implemented.
2. **Question** — Asks for clarification or rationale. Reply with an explanation but no code change.
3. **Informational / Praise** — Acknowledgement, approval, or FYI. No action needed — skip silently.
4. **Already addressed** — The comment describes something that was already fixed (check the current code, not just the diff). Reply confirming it's been handled.

When a comment thread has replies, read the full thread to understand the latest state — an initial request may have been refined or withdrawn in follow-up replies.

### Step 4: Implement the changes

For each actionable comment:

1. Read the referenced file and understand the surrounding code.
2. If the project has a CLAUDE.md with coding conventions, follow them (PHPCS, naming, escaping, etc.).
3. Make the change. Prefer minimal, focused edits — don't refactor unrelated code.
4. If the comment is vague or the right fix is ambiguous, choose the most reasonable interpretation and note your reasoning in the PR reply.

After all changes are made:

1. Run any project linting/checks if they exist (e.g., `composer cs-check`, `npm run build`). Fix violations before committing.
2. Stage only the files you changed.
3. Commit with a clear message that references the PR:

```bash
git commit -m "$(cat <<'EOF'
fix: address PR review feedback

- <brief description of change 1>
- <brief description of change 2>
- ...

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

4. Push to the remote branch.

### Step 5: Reply to each comment

After pushing, reply to every comment you acted on. Use the GitHub API to post replies directly in the review thread so reviewers see responses inline.

```bash
# Reply to an inline review comment.
gh api repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies \
  -f body="<your reply>"

# Reply to an issue-level comment.
gh api repos/{owner}/{repo}/issues/{number}/comments \
  -f body="<your reply>"
```

**Reply format per category:**

- **Actionable (implemented):** Briefly describe what was changed and why. Reference the commit if helpful. Example: "Fixed — updated `get_language_slug_for_post()` to also resolve the country term, producing full BCP 47 codes like `en-gb` instead of bare `en`."
- **Question:** Answer the question clearly. If the answer requires looking at code you've already read, include the relevant context.
- **Already addressed:** "This was already addressed in commit `abc1234` — [brief explanation of what was done]."

Keep replies concise and technical. No filler.

### Step 6: Summary

After all replies are posted, give the user a short summary:

- How many comments were found
- How many were actionable (and implemented)
- How many were questions (and answered)
- How many were skipped (informational/praise)
- The commit SHA and push status
- Any comments you chose NOT to implement, with a brief reason why

## Edge Cases

- **Outdated diff comments**: If a review comment references a line that no longer exists (file was refactored or deleted), note this in the reply and skip the change.
- **Conflicting comments**: If two reviewers suggest contradictory changes, implement the one that aligns better with the codebase conventions and explain your choice in both replies.
- **Comments on files you can't change**: If a comment targets generated files, vendor dependencies, or files outside the repo, reply explaining why you can't change it.
- **Empty PR / no comments**: If there are no actionable comments, tell the user there's nothing to address.
