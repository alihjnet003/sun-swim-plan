
-- 1. Audit logs: explicit admin-only DELETE; UPDATE remains denied (no policy)
CREATE POLICY "admins delete audit"
  ON public.audit_logs FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. Backup storage bucket: admin-only write/update/delete on storage.objects
CREATE POLICY "admins upload backups"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'backups' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins update backups"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'backups' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins delete backups"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Revoke EXECUTE on internal SECURITY DEFINER functions
-- Trigger-only functions: no one should call directly
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_booking_updated_by() FROM PUBLIC, anon, authenticated;

-- Role-check helpers: only authenticated needs EXECUTE (used by RLS); revoke from anon/public
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff_or_admin(uuid) FROM PUBLIC, anon;
