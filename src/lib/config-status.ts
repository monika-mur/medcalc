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
      // SUPABASE_KEY is deliberately NOT interpolated here: astro.config.mjs declares it
      // `access: "secret"`, and this message renders in the UI.
      message: `Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone. SUPABASE_URL: ${SUPABASE_URL ?? "(nie ustawiony)"}`,
      docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
      docsLabel: "Zobacz instrukcję konfiguracji",
    },
  ];
  return statuses.filter((s) => !s.configured);
}
