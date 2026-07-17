package forge.payments

# Default verdict is deny — fail closed (CLAUDE.md §4, §8).
default allow = false

# This policy's mode: "enforce" or "shadow". In shadow mode, the gateway still
# evaluates this policy and logs the verdict, but does not actually block the action.
mode = "enforce"

# What actions this agent type is allowed to perform at all.
allowed_actions = {"issue_refund", "adjust_limit"}

# Hard ceiling on any single action's amount, regardless of spend caps in Redis.
# Spend caps (hourly/daily) are enforced separately by the gateway using Redis —
# this is just the per-action ceiling the policy itself is aware of.
max_single_action_amount = 500

# allow is true only if BOTH conditions hold:
#   1. the requested action is in this agent type's allowed set
#   2. the requested amount does not exceed the single-action ceiling
allow if {
    input.action == allowed_actions[_]
    input.amount <= max_single_action_amount
}
