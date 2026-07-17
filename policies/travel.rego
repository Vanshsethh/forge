package forge.travel

default allow = false

mode = "enforce"

# Travel agents rebook flights and adjust hotel stays during disruptions —
# amount here represents the cost delta of the rebooking/change.
allowed_actions = {"rebook_flight", "modify_hotel_booking"}

max_single_action_amount = 800

allow if {
    input.action == allowed_actions[_]
    input.amount <= max_single_action_amount
}
