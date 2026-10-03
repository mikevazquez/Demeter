alter table public.assistant_pending_actions
  drop constraint if exists assistant_pending_actions_action_type_check;

alter table public.assistant_pending_actions
  add constraint assistant_pending_actions_action_type_check
  check (
    action_type = any (
      array[
        'booking.create'::text,
        'booking.cancel'::text,
        'booking.reschedule'::text,
        'waitlist.join'::text,
        'account.activate'::text,
        'enrollment.resolve'::text,
        'commerce.transfer_package_choice'::text
      ]
    )
  );