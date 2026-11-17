import type { ActorRole } from '../engine/types';

interface ActorAvatarProps {
  name: string;
  role: ActorRole;
  color: string;
  mood?: 'normal' | 'happy' | 'air' | 'carrying';
  size?: number;
}

export function getActorArchetype(role: ActorRole, color: string): 'operator' | 'alpha' | 'beta' | 'gamma' | 'delta' {
  if (role === 'human') return 'operator';
  const c = color.toUpperCase();
  if (c === '#F59E0B') return 'alpha';
  if (c === '#10B981') return 'beta';
  if (c === '#F472B6') return 'gamma';
  return 'delta';
}

export function ActorAvatar({
  name,
  role,
  color,
  mood = 'normal',
  size = 30,
}: ActorAvatarProps) {
  const archetype = getActorArchetype(role, color);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      className="shrink-0"
      aria-label={`${name} portrait`}
    >
      {/* Subtle rounded backdrop tile */}
      <rect
        x="1.5"
        y="1.5"
        width="33"
        height="33"
        rx="8"
        fill="#0B1018"
        stroke={color}
        strokeOpacity="0.45"
        strokeWidth="1.25"
      />

      {/* Archetype Headgear / Antenna */}
      {archetype === 'operator' && (
        <>
          {/* Helmet crest & trailing scarf hint */}
          <path d="M9 12 C9 8, 27 8, 27 12" fill="none" stroke="#E0F2FE" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M8 27 L4 30 L7 31" fill={color} opacity="0.8" />
        </>
      )}
      {archetype === 'alpha' && (
        <>
          {/* Twin-coil spring antenna */}
          <path d="M18 9 L16 6 L20 4.5 L18 2.5" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="18" cy="2.5" r="1.8" fill="#FEF3C7" />
        </>
      )}
      {archetype === 'beta' && (
        <>
          {/* Swept aero-fins */}
          <path d="M11 12 L7 6 L14 10" fill={color} />
          <path d="M25 12 L29 6 L22 10" fill={color} />
        </>
      )}
      {archetype === 'gamma' && (
        <>
          {/* Dual relay dishes */}
          <circle cx="12" cy="7" r="2.2" fill={color} />
          <circle cx="24" cy="7" r="2.2" fill={color} />
          <line x1="13" y1="9" x2="14" y2="11" stroke={color} strokeWidth="1.5" />
          <line x1="23" y1="9" x2="22" y2="11" stroke={color} strokeWidth="1.5" />
        </>
      )}
      {archetype === 'delta' && (
        <>
          {/* Prism crest */}
          <polygon points="18,3 22,10 14,10" fill={color} />
        </>
      )}

      {/* Character Head / Chassis */}
      <rect
        x="8"
        y="10"
        width="20"
        height="19"
        rx={archetype === 'beta' ? 7 : 4.5}
        fill={color}
        stroke="#0F172A"
        strokeWidth="1.5"
      />

      {/* Visor Window */}
      <rect
        x="10.5"
        y="13.5"
        width="15"
        height="8"
        rx="2.5"
        fill="#0B1018"
      />

      {/* Expressive Eyes inside Visor */}
      {mood === 'happy' ? (
        <>
          <path d="M12.5 18.2 Q14.5 15.6 16.5 18.2" fill="none" stroke={archetype === 'operator' ? '#F8FAFC' : color} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M19.5 18.2 Q21.5 15.6 23.5 18.2" fill="none" stroke={archetype === 'operator' ? '#F8FAFC' : color} strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : archetype === 'beta' ? (
        <>
          {/* Cyclops wide scanner eye */}
          <rect x="13" y="16" width="10" height="3" rx="1.5" fill="#A7F3D0" />
          <circle cx={mood === 'air' ? 19.5 : 18} cy="17.5" r="1.4" fill="#064E3B" />
        </>
      ) : (
        <>
          <rect
            x="13"
            y={mood === 'carrying' ? 16.2 : 15.5}
            width="3.2"
            height={mood === 'carrying' ? 2.6 : 4}
            rx="1"
            fill={archetype === 'operator' ? '#F8FAFC' : '#FEF3C7'}
          />
          <rect
            x="19.8"
            y={mood === 'carrying' ? 16.2 : 15.5}
            width="3.2"
            height={mood === 'carrying' ? 2.6 : 4}
            rx="1"
            fill={archetype === 'operator' ? '#F8FAFC' : '#FEF3C7'}
          />
        </>
      )}

      {/* Chest / Collar Detail */}
      <rect x="14" y="23.5" width="8" height="2.6" rx="1.3" fill="#0F172A" opacity="0.45" />
      <circle cx="18" cy="24.8" r="1.1" fill={mood === 'happy' ? '#34D399' : '#F8FAFC'} opacity="0.85" />
    </svg>
  );
}
