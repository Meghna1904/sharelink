import React from "react";

interface PartnerBadgeProps {
  name: string;
  size?: "sm" | "md";
}

const TINTS = ["sage", "rose", "slate", "ochre"] as const;

function getTintForName(name: string): (typeof TINTS)[number] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % TINTS.length;
  return TINTS[index]!;
}

export const PartnerBadge: React.FC<PartnerBadgeProps> = ({ name, size = "md" }) => {
  const initial = (name.trim()[0] || "?").toUpperCase();
  const tint = getTintForName(name);

  return (
    <span
      className={`partner-badge partner-badge--${tint} partner-badge--${size}`}
      title={`Saved by ${name}`}
      aria-label={`Partner ${name}`}
    >
      {initial}
    </span>
  );
};
