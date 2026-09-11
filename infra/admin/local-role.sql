-- Run as the database owner, after creating a dedicated non-superuser login.
-- psql variables: admin_role, admin_database. This grants no object ownership,
-- schema creation, deletion, truncation, worker-state access, or role membership.
GRANT CONNECT ON DATABASE :"admin_database" TO :"admin_role";
GRANT USAGE ON SCHEMA public TO :"admin_role";
GRANT SELECT, INSERT, UPDATE ON public.pizza_places, public.taco_places,
  public.place_sources TO :"admin_role";
GRANT SELECT, UPDATE ON public.source_review_queue TO :"admin_role";
GRANT SELECT, INSERT ON public.source_review_decision_history,
  public.place_lifecycle_history TO :"admin_role";
GRANT SELECT ON public.source_review_ai_assessments TO :"admin_role";
GRANT USAGE ON SEQUENCE public.place_sources_id_seq,
  public.source_review_decision_history_id_seq,
  public.place_lifecycle_history_id_seq TO :"admin_role";
