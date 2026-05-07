import { SignUp } from '@clerk/nextjs';

// DECISION: en Fase 0 (sin keys de Clerk) muestra placeholder en lugar de crashear.
export default function SignUpPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <p className="text-gray-600">Clerk no configurado todavía (Fase 1).</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <SignUp />
    </div>
  );
}
