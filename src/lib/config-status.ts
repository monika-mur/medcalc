export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export function getMissingConfigs(): ConfigStatus[] {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  const statuses: ConfigStatus[] = [
    {
      name: "Supabase",
      configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
      // Neither value is interpolated here: astro.config.mjs declares both
      // `access: "secret"`, and this message renders in the public UI. The status
      // only reports presence — the developer already knows their own URL.
      message: `Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone. SUPABASE_URL: ${SUPABASE_URL ? "ustawiony" : "nie ustawiony"}`,
      docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
      docsLabel: "Zobacz instrukcję konfiguracji",
    },
  ];
  return statuses.filter((s) => !s.configured);
}
