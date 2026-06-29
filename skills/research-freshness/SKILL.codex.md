---
name: research-freshness
description: >-
  Improve research accuracy with freshness-first query planning, multi-angle verification,
  and detailed expectation-aligned output.
  Use when the user asks to research, look up, verify, investigate, compare, or summarize information.
  Trigger especially for requests containing latest/current/recent/today/news/update wording.
  Always build date-aware queries from the current date, prioritize newer credible sources over older ones,
  test key claims with counterevidence, and surface publication/update dates in the answer.
---

# Research Freshness Guard

Apply a freshness-first workflow for research tasks.
Use this skill as prompt guidance only. Do not rely on skill-specific scripts.

## Execute

1. Determine the current date in the user's locale before searching.
2. Rewrite the request into date-aware queries that include `YYYY-MM-DD`.
3. Collect evidence from three angles: primary source, independent source, challenge source.
4. Prefer newer authoritative sources for time-sensitive topics.
5. Resolve conflicts by authority plus recency and state the reason.
6. Report unknowns when evidence is weak or stale.

## Query Patterns

Use at least one query from each group.

Primary:

- `<topic> official statement OR documentation <YYYY-MM-DD>`
- `<topic> release notes OR changelog <YYYY-MM-DD>`

Independent:

- `<topic> market analysis OR industry report <YYYY-MM-DD>`
- `<topic> site:gov OR site:edu OR site:org <YYYY-MM-DD>`

Challenge:

- `<claim> criticism OR limitations <YYYY-MM-DD>`
- `<claim> debunked OR controversy <YYYY-MM-DD>`

Optional baseline:

- `<topic> status in <YYYY-1>`

## Verification Checklist

Validate every major claim before finalizing.

- Confirm with at least 2 independent sources.
- Include at least 1 primary source when available.
- Ensure each key source has an explicit date.
- Check number/date consistency across sources.
- Include the strongest conflicting evidence and explain the resolution.

If a check fails, mark the claim as uncertain.

## Output Contract

Always include:

- `What you asked` in 1 line.
- `As of <YYYY-MM-DD>`.
- Direct answer first.
- Detailed findings by perspective: official, independent, critical.
- Key claim to source-date mapping.
- Confidence (`high` / `medium` / `low`) with reason.
- Gaps, staleness risk, and what to verify next.
