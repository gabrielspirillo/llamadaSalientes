'use client';

import { BoardCard } from '@/components/ui/board';
import { useEffect, useState } from 'react';

type TeamAvatar = { id: string; name: string; imageUrl: string | null };

/**
 * Bloque del equipo en el tablero del panel. Igual que en el tablero de
 * referencia, muestra las caras del equipo; al abrirlo lleva a la ficha de
 * cada persona en /dashboard/team.
 */
export function TeamBoardCard() {
  const [members, setMembers] = useState<TeamAvatar[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch('/api/team/avatars')
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d: { members?: TeamAvatar[] }) => {
        if (!mounted) return;
        setMembers(d.members ?? []);
        setLoaded(true);
      })
      .catch(() => mounted && setLoaded(true));
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <BoardCard
      href="/dashboard/team"
      tone="blossom"
      tags={['equipo', 'accesos']}
      title="Quién trabaja en la clínica"
      noteLabel="Equipo:"
      note={
        loaded
          ? members.length === 1
            ? '1 persona con acceso al panel'
            : `${members.length} personas con acceso al panel`
          : 'Cargando…'
      }
      people={members.map((m) => m.name)}
      counts={{ comments: members.length }}
    />
  );
}
