alter table public.automation_communication_settings
  add constraint automation_communication_settings_nonempty_window_chk
  check (
    global_send_window is null
    or split_part(global_send_window, '-', 1) <> split_part(global_send_window, '-', 2)
  );
