package forge.servicing

default allow = false

mode = "enforce"

# Servicing agents handle routine account requests — not direct payments,
# but each still has a dollar impact (e.g. fee waived, limit increase amount).
allowed_actions = {"reverse_fee", "increase_credit_limit", "replace_card"}

max_single_action_amount = 1000

allow if {
    input.action == allowed_actions[_]
    input.amount <= max_single_action_amount
}
