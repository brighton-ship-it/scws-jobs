-- Jobber OAuth tokens live in settings.key = 'jobber_oauth' (encrypted).
-- Hide that row from authenticated / admin settings reads. The service
-- role used by src/lib/jobber/token-store.ts bypasses RLS.

DROP POLICY IF EXISTS "Authenticated users can view settings" ON public.settings;
CREATE POLICY "Authenticated users can view settings" ON public.settings
    FOR SELECT USING (
        auth.role() = 'authenticated'
        AND key <> 'jobber_oauth'
    );

DROP POLICY IF EXISTS "Admins can manage settings" ON public.settings;
CREATE POLICY "Admins can manage settings" ON public.settings
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
        AND key <> 'jobber_oauth'
    );
