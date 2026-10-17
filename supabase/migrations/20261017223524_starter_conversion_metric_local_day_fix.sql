-- Calculate conversion days using the studio's local calendar date.
create or replace view public.student_entry_conversion_facts
with (security_invoker = true)
as
 WITH ranked AS (
         SELECT s.studio_id,
            s.student_id,
            s.id AS sale_id,
            s.created_at AS sale_created_at,
            sl.product_template_id,
            pt.name AS product_name,
            pt.product_type::text AS product_type,
            pt.purchase_eligibility,
            row_number() OVER (PARTITION BY s.studio_id, s.student_id ORDER BY s.created_at, s.id, sl.id) AS rn
           FROM sales s
             JOIN sale_lines sl ON sl.sale_id = s.id AND sl.studio_id = s.studio_id
             JOIN product_templates pt ON pt.id = sl.product_template_id AND pt.studio_id = sl.studio_id
          WHERE s.status = 'confirmed'::sale_status AND (pt.product_type::text = ANY (ARRAY['single_class'::text, 'package'::text, 'membership'::text]))
        ), entry AS (
         SELECT ranked.studio_id,
            ranked.student_id,
            ranked.sale_id,
            ranked.sale_created_at,
            ranked.product_template_id,
            ranked.product_name,
            ranked.product_type,
            ranked.purchase_eligibility,
            ranked.rn
           FROM ranked
          WHERE ranked.rn = 1
        ), conversion AS (
         SELECT e_1.studio_id,
            e_1.student_id,
            min(s.created_at) AS converted_at
           FROM entry e_1
             JOIN sales s ON s.studio_id = e_1.studio_id AND s.student_id = e_1.student_id AND s.status = 'confirmed'::sale_status
             JOIN sale_lines sl ON sl.sale_id = s.id AND sl.studio_id = s.studio_id
             JOIN product_templates pt ON pt.id = sl.product_template_id AND pt.studio_id = sl.studio_id
          WHERE s.created_at > e_1.sale_created_at AND (pt.product_type::text = ANY (ARRAY['package'::text, 'membership'::text])) AND pt.purchase_eligibility = 'all'::text
          GROUP BY e_1.studio_id, e_1.student_id
        )
 SELECT e.studio_id,
    e.student_id,
    st.person_id,
    st.acquisition_source,
    e.sale_id AS first_sale_id,
    e.sale_created_at AS first_purchase_at,
    e.product_template_id AS first_product_template_id,
    e.product_name AS first_product_name,
    e.product_type AS first_product_type,
        CASE
            WHEN e.product_type = 'single_class'::text THEN 'single_class'::text
            WHEN e.purchase_eligibility = 'new_customer'::text THEN 'introductory_package'::text
            WHEN e.product_type = ANY (ARRAY['package'::text, 'membership'::text]) THEN 'regular_package'::text
            ELSE e.product_type
        END AS entry_mode,
    c.converted_at AS regular_package_converted_at,
    c.converted_at IS NOT NULL AS converted_to_regular_package,
        CASE
            WHEN c.converted_at IS NULL THEN NULL::integer
            ELSE GREATEST(0, (c.converted_at AT TIME ZONE COALESCE(studio.timezone, 'America/Mexico_City'::text))::date - (e.sale_created_at AT TIME ZONE COALESCE(studio.timezone, 'America/Mexico_City'::text))::date)
        END AS days_to_regular_package
   FROM entry e
     JOIN students st ON st.id = e.student_id AND st.studio_id = e.studio_id
     JOIN studios studio ON studio.id = e.studio_id
     LEFT JOIN conversion c ON c.studio_id = e.studio_id AND c.student_id = e.student_id;;

revoke all on public.student_entry_conversion_facts from public,anon,authenticated;
grant select on public.student_entry_conversion_facts to authenticated;
