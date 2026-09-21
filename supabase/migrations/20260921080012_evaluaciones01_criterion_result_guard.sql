
-- EVALUACIONES-01 · Keep calculated criterion results immutable after publication.

create trigger technical_evaluation_criterion_results_guard
before insert or update or delete on public.technical_evaluation_criterion_results
for each row execute function private.evaluations_guard_result_history();
