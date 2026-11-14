/**
 * Se vuelve a montar en cada navegación entre secciones (así funcionan los
 * `template` de Next). Lo que entra nuevo —el esqueleto y después la página—
 * aparece con un fundido corto (`.route-view` en globals.css) en vez de
 * cambiar de golpe. Sólo opacidad: un `transform` aquí haría de contenedor de
 * los `position: fixed` de dentro (chat a pantalla completa, botones
 * flotantes) mientras dura la animación.
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="route-view">{children}</div>;
}
