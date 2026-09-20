create policy reward_rules_student_self_read
on public.reward_rules
for select
to authenticated
using (
  exists (
    select 1
    from public.reward_participations p
    where p.rule_id = reward_rules.id
      and p.studio_id = reward_rules.studio_id
      and private.is_reward_student_self(p.studio_id, p.student_id)
  )
  or exists (
    select 1
    from public.reward_instances r
    where r.rule_id = reward_rules.id
      and r.studio_id = reward_rules.studio_id
      and private.is_reward_student_self(r.studio_id, r.student_id)
  )
  or exists (
    select 1
    from public.reward_achievement_unlocks a
    where a.rule_id = reward_rules.id
      and a.studio_id = reward_rules.studio_id
      and private.is_reward_student_self(a.studio_id, a.student_id)
  )
);

create policy reward_rule_versions_student_self_read
on public.reward_rule_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.reward_participations p
    where p.rule_id = reward_rule_versions.rule_id
      and p.joined_version_number = reward_rule_versions.version_number
      and p.studio_id = reward_rule_versions.studio_id
      and private.is_reward_student_self(p.studio_id, p.student_id)
  )
  or exists (
    select 1
    from public.reward_instances r
    where r.rule_id = reward_rule_versions.rule_id
      and r.version_number = reward_rule_versions.version_number
      and r.studio_id = reward_rule_versions.studio_id
      and private.is_reward_student_self(r.studio_id, r.student_id)
  )
  or exists (
    select 1
    from public.reward_achievement_unlocks a
    where a.rule_id = reward_rule_versions.rule_id
      and a.version_number = reward_rule_versions.version_number
      and a.studio_id = reward_rule_versions.studio_id
      and private.is_reward_student_self(a.studio_id, a.student_id)
  )
);
