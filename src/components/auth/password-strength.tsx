"use client";

interface PasswordRequirement {
  label: string;
  met: boolean;
}

export function validatePassword(password: string): {
  isValid: boolean;
  requirements: PasswordRequirement[];
} {
  const requirements: PasswordRequirement[] = [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "Contains uppercase letter", met: /[A-Z]/.test(password) },
    { label: "Contains lowercase letter", met: /[a-z]/.test(password) },
    { label: "Contains a number", met: /\d/.test(password) },
  ];

  return {
    isValid: requirements.every((r) => r.met),
    requirements,
  };
}

export function PasswordStrengthIndicator({ password }: { password: string }) {
  if (!password) return null;

  const { requirements } = validatePassword(password);
  const metCount = requirements.filter((r) => r.met).length;

  // Strength reads as progress along a route, not as a verdict:
  // hollow (weak) → gold (getting there) → sapphire (strong).
  // Never red/green — those channels mean other things in this system.
  const strengthColor =
    metCount <= 2 ? "bg-hollow" : metCount === 3 ? "bg-gold" : "bg-sapphire";

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {requirements.map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 transition-colors ${
              i < metCount ? strengthColor : "bg-muted"
            }`}
          />
        ))}
      </div>
      <ul className="space-y-0.5">
        {requirements.map((req) => (
          <li
            key={req.label}
            className={`flex items-center gap-1.5 text-sm ${
              req.met ? "text-ink" : "text-ink-muted"
            }`}
          >
            <span>{req.met ? "✓" : "○"}</span>
            {req.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
