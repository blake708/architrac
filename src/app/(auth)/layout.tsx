import { LogoMark } from "@/components/shell/logo-mark";

// Sign-in, sign-up and onboarding: no menu rail or header, just the logo and
// a centred card (app-shell spec, layout section 5).
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-4 py-12 text-ink">
      <LogoMark />
      <div className="flex w-full max-w-[440px] justify-center">{children}</div>
    </div>
  );
}
