'use client';

import { useEffect, useRef, useState } from 'react';

// Prefijos del selector. La autoridad es la lista blanca del backend; esto es
// comodidad de UI. España es el mercado del piloto y Portugal el otro país
// donde el cliente tiene delegados; Argentina está para que podamos probarla
// nosotros. Los tres están en DEFAULT_DEMO_ALLOWED_COUNTRY_CODES.
const PREFIXES = [
  { code: '+34', label: 'España +34' },
  { code: '+351', label: 'Portugal +351' },
  { code: '+54', label: 'Argentina +54' },
];

// Lo que el pliego pide que no se negocie, y que la demo demuestra en vivo.
const FACTS = [
  { k: 'Se identifica', v: 'Declara que es IA en la primera frase' },
  { k: 'Español de España', v: 'Voz y guion peninsulares' },
  { k: 'Interrumpible', v: 'Se le puede cortar a media frase' },
  { k: 'Latencia medida', v: '1,1 s de mediana, extremo a extremo' },
];

// Lo que va a pasar en la llamada. Saberlo de antemano es lo que convierte
// "una demo" en "una prueba": el evaluador sabe contra qué medir.
const STEPS = [
  'Se presenta, dice la marca y el sector, y pide permiso para seguir.',
  'Pregunta si la farmacia trabaja la categoría y quién lleva las compras.',
  'Si hay encaje, propone una cita con el equipo comercial o enviar catálogo.',
];

type Status = 'idle' | 'loading' | 'success' | 'error';
type WebStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export function SapinnDemo() {
  // 'web' = hablar con el agente por el navegador (WebRTC, sin telefonía).
  // 'phone' = que el agente llame a un teléfono (depende de la línea saliente).
  const [mode, setMode] = useState<'web' | 'phone'>('web');
  const [prefix, setPrefix] = useState('+34');
  const [number, setNumber] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [webStatus, setWebStatus] = useState<WebStatus>('idle');
  const [webMsg, setWebMsg] = useState('');
  const clientRef = useRef<{ stopCall?: () => void } | null>(null);

  // Corta la llamada web si el visitante se va de la página con ella activa.
  useEffect(() => {
    return () => clientRef.current?.stopCall?.();
  }, []);

  async function startWebCall() {
    if (webStatus === 'connecting' || webStatus === 'live') return;
    setWebStatus('connecting');
    setWebMsg('');
    try {
      const res = await fetch('/api/public/demo-web-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
        error?: string;
      };
      if (!res.ok || !data.accessToken) {
        setWebStatus('error');
        setWebMsg(data.error ?? 'No hemos podido iniciar la prueba. Inténtalo en un momento.');
        return;
      }

      const { RetellWebClient } = await import('retell-client-js-sdk');
      const client = new RetellWebClient();
      clientRef.current = client;

      client.on('call_ready', () => {
        const c = clientRef.current as { startAudioPlayback?: () => Promise<void> } | null;
        c?.startAudioPlayback?.().catch(() => {});
      });
      client.on('call_started', () => setWebStatus('live'));
      client.on('call_ended', () => setWebStatus('ended'));
      client.on('error', () => {
        setWebStatus('error');
        setWebMsg('La llamada se ha cortado. Inténtalo de nuevo.');
        clientRef.current?.stopCall?.();
      });

      // startCall pide permiso de micrófono internamente.
      await (
        client as { startCall: (o: { accessToken: string; sampleRate?: number }) => Promise<void> }
      ).startCall({ accessToken: data.accessToken, sampleRate: 24000 });
    } catch (err) {
      setWebStatus('error');
      const denied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'NotFoundError');
      setWebMsg(
        denied
          ? 'Necesitamos permiso del micrófono para que puedas hablar con el agente.'
          : 'No hemos podido conectar. Revisa tu conexión e inténtalo de nuevo.',
      );
    }
  }

  function endWebCall() {
    clientRef.current?.stopCall?.();
    setWebStatus('ended');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'loading') return;
    const digits = number.replace(/[^\d]/g, '');
    if (digits.length < 6) {
      setStatus('error');
      setMessage('Escribe el número sin el prefijo del país, sólo los dígitos.');
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      // Endpoint propio de Sapinn: llama con el agente de farmacia. El de
      // Futura (/api/public/demo-call) dispara el agente de clínicas.
      const res = await fetch('/api/public/sapinn-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `${prefix}${digits}` }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (res.ok && data.ok) {
        setStatus('success');
        setMessage(data.message ?? 'Te estamos llamando. Descuelga el teléfono.');
      } else {
        setStatus('error');
        setMessage(data.error ?? 'No hemos podido lanzar la llamada. Inténtalo en un momento.');
      }
    } catch {
      setStatus('error');
      setMessage('No hemos podido conectar. Revisa tu conexión e inténtalo de nuevo.');
    }
  }

  const orbState =
    webStatus === 'connecting'
      ? 'connecting'
      : webStatus === 'live'
        ? 'live'
        : webStatus === 'ended'
          ? 'ended'
          : 'idle';

  const orbLabel =
    webStatus === 'connecting'
      ? 'Conectando…'
      : webStatus === 'live'
        ? 'Te escucha. Habla con normalidad.'
        : webStatus === 'ended'
          ? 'Llamada finalizada'
          : 'Pulsa para hablar';

  function switchMode(next: 'web' | 'phone') {
    if (next === mode) return;
    clientRef.current?.stopCall?.();
    setWebStatus('idle');
    setWebMsg('');
    setStatus('idle');
    setMessage('');
    setMode(next);
  }

  return (
    <div className="sp-root">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: hoja de estilos estática de la página */}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="sp-bg" aria-hidden="true">
        <div className="sp-aurora" />
        <div className="sp-grid" />
        <div className="sp-vignette" />
      </div>

      <header className="sp-bar">
        <div className="sp-lockup">
          Futura Solutions <i>×</i> Sapinn Consulting
        </div>
        <div className="sp-badge">
          <span className="sp-badge-dot" /> Demo
        </div>
      </header>

      <main className="sp-main">
        <div className="sp-split">
          {/* ── Titular ── */}
          <section className="sp-intro sp-enter">
            <p className="sp-eyebrow">Agente de voz saliente para farmacias</p>
            <h1 className="sp-title">
              Escúchalo antes de <span className="sp-title-hl">decidir</span>.
            </h1>
            <p className="sp-lead">
              Es el sistema que llamaría a las farmacias del territorio sin cubrir. Responde en
              tiempo real y se le puede interrumpir.
            </p>
          </section>

          {/* ── Garantías y letra pequeña. En móvil van DESPUÉS de la consola:
                 el visitante viene a pulsar el botón, no a leer. ── */}
          <section className="sp-support sp-enter" style={{ animationDelay: '.14s' }}>
            <dl className="sp-facts">
              {FACTS.map((f) => (
                <div key={f.k} className="sp-fact">
                  <dt>{f.k}</dt>
                  <dd>{f.v}</dd>
                </div>
              ))}
            </dl>

            <p className="sp-note">
              <strong>Es una demostración.</strong> El asistente no tiene cargados el catálogo, la
              agenda ni los datos reales del cliente, así que puede improvisar información. La voz,
              la dicción y el guion se ajustan a medida en la versión definitiva.
            </p>
          </section>

          {/* ── Columna derecha: la consola ── */}
          <section className="sp-panel sp-enter" style={{ animationDelay: '.1s' }}>
            <div className="sp-seg" role="tablist" aria-label="Cómo quieres probarlo">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'web'}
                className={`sp-seg-btn ${mode === 'web' ? 'is-on' : ''}`}
                onClick={() => switchMode('web')}
              >
                Por el navegador
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'phone'}
                className={`sp-seg-btn ${mode === 'phone' ? 'is-on' : ''}`}
                onClick={() => switchMode('phone')}
              >
                Recibir una llamada
              </button>
            </div>

            {mode === 'web' ? (
              <div className="sp-console">
                <p className="sp-console-hint">
                  Hablas con el agente desde este navegador. Necesita permiso del micrófono.
                </p>
                <button
                  type="button"
                  className={`sp-orb sp-orb-${orbState}`}
                  onClick={webStatus === 'live' ? endWebCall : startWebCall}
                  aria-label={webStatus === 'live' ? 'Colgar la llamada' : 'Hablar con el agente'}
                >
                  <span className="sp-orb-ring" />
                  <span className="sp-orb-core">
                    {webStatus === 'live' ? (
                      <span className="sp-eq" aria-hidden="true">
                        {[0, 1, 2, 3].map((i) => (
                          <span key={`b-${i}`} style={{ animationDelay: `${i * 0.13}s` }} />
                        ))}
                      </span>
                    ) : webStatus === 'connecting' ? (
                      <span className="sp-spin" aria-hidden="true" />
                    ) : (
                      <MicIcon />
                    )}
                  </span>
                </button>

                <p className={`sp-state sp-state-${orbState}`}>{orbLabel}</p>

                {/* Sólo se monta cuando hay botón: si no, dejaba un hueco
                    muerto bajo el estado y el panel parecía sin terminar. */}
                {webStatus === 'live' && (
                  <div className="sp-actions">
                    <button type="button" className="sp-btn sp-btn-ghost" onClick={endWebCall}>
                      Colgar
                    </button>
                  </div>
                )}
                {(webStatus === 'ended' || webStatus === 'error') && (
                  <div className="sp-actions">
                    <button
                      type="button"
                      className="sp-btn sp-btn-primary"
                      onClick={() => {
                        setWebStatus('idle');
                        setWebMsg('');
                      }}
                    >
                      Hablar otra vez
                    </button>
                  </div>
                )}

                {webStatus === 'error' && <p className="sp-err">{webMsg}</p>}
              </div>
            ) : (
              <div className="sp-console">
                {status !== 'success' ? (
                  <form onSubmit={submit} className="sp-form">
                    <p className="sp-console-hint">
                      El agente marca tu número y te habla como hablaría a una farmacia.
                    </p>
                    <div className="sp-field">
                      <select
                        value={prefix}
                        onChange={(ev) => setPrefix(ev.target.value)}
                        className="sp-select"
                        disabled={status === 'loading'}
                        aria-label="Prefijo del país"
                      >
                        {PREFIXES.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <input
                        inputMode="tel"
                        autoComplete="tel-national"
                        placeholder="600 000 000"
                        value={number}
                        onChange={(ev) => setNumber(ev.target.value)}
                        className="sp-input"
                        disabled={status === 'loading'}
                        aria-label="Tu número de teléfono"
                      />
                    </div>
                    <button
                      type="submit"
                      className="sp-btn sp-btn-primary sp-btn-wide"
                      disabled={status === 'loading'}
                    >
                      {status === 'loading' ? (
                        <>
                          <span className="sp-spin sp-spin-sm" /> Lanzando la llamada…
                        </>
                      ) : (
                        <>
                          <PhoneIcon /> Que me llame
                        </>
                      )}
                    </button>
                    {status === 'error' && <p className="sp-err">{message}</p>}
                    <p className="sp-fine">
                      Usamos tu número sólo para esta llamada de prueba. No queda en ninguna lista.
                    </p>
                  </form>
                ) : (
                  <div className="sp-ok">
                    <div className="sp-ok-mark" aria-hidden="true">
                      <PhoneIcon />
                    </div>
                    <p className="sp-state sp-state-live">{message}</p>
                    <button
                      type="button"
                      className="sp-btn sp-btn-ghost"
                      onClick={() => {
                        setStatus('idle');
                        setMessage('');
                        setNumber('');
                      }}
                    >
                      Probar con otro número
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
          {/* ── Qué va a pasar en la llamada. Va en la columna de la consola
                 para que toda la página quepa en una pantalla. ── */}
          <section className="sp-steps sp-enter" style={{ animationDelay: '.18s' }}>
            <h2 className="sp-steps-h">Qué vas a escuchar</h2>
            <ol className="sp-steps-list">
              {STEPS.map((s, i) => (
                <li key={s}>
                  <span className="sp-step-n">{String(i + 1).padStart(2, '0')}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 11.5a16 16 0 0 0 6 6l1-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2Z" />
    </svg>
  );
}

const CSS = `
.sp-root{
  --bg:#05080b;--panel:rgba(255,255,255,.028);--line:rgba(255,255,255,.09);
  --lime:#8bd835;--lime-br:#a8ec5c;--lime-dp:#3f6b1e;
  --hi:#f2f6f1;--tx:#96a49e;--dim:#606d67;
  --out:cubic-bezier(.22,1,.36,1);
  position:relative;min-height:100svh;background:var(--bg);color:var(--tx);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;overflow-x:hidden;display:flex;flex-direction:column;
}
.sp-root *{box-sizing:border-box;}

/* ── Fondo: sobrio, una sola aurora y muy contenida ── */
.sp-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:radial-gradient(110% 70% at 50% -15%,#0a1210 0%,var(--bg) 58%);}
.sp-aurora{position:absolute;width:70vw;height:70vw;max-width:820px;max-height:820px;border-radius:50%;
  background:radial-gradient(circle,rgba(139,216,53,.30),transparent 64%);filter:blur(100px);
  top:-26%;left:50%;transform:translateX(-50%);}
.sp-grid{position:absolute;inset:0;
  background-image:linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px);
  background-size:72px 72px;mask-image:radial-gradient(85% 65% at 50% 25%,#000 15%,transparent 78%);}
.sp-vignette{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 40%,transparent 52%,rgba(0,0,0,.6));}

/* ── Barra ── */
.sp-bar{position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center;gap:16px;
  padding:clamp(12px,1.8vh,18px) clamp(18px,4vw,44px);flex:none;border-bottom:1px solid rgba(255,255,255,.055);}
.sp-lockup{font-size:.82rem;font-weight:600;letter-spacing:-.005em;color:var(--hi);}
.sp-lockup i{color:var(--lime);margin:0 6px;font-style:normal;font-weight:500;}
.sp-badge{display:inline-flex;align-items:center;gap:8px;font-size:.68rem;font-weight:600;letter-spacing:.1em;
  text-transform:uppercase;color:var(--tx);border:1px solid var(--line);border-radius:999px;padding:7px 14px;background:var(--panel);}
.sp-badge-dot{width:6px;height:6px;border-radius:50%;background:var(--lime);box-shadow:0 0 10px var(--lime);animation:sp-blink 2.6s ease-in-out infinite;}
@keyframes sp-blink{0%,100%{opacity:1}50%{opacity:.3}}

/* ── Layout ── */
.sp-main{position:relative;z-index:2;flex:1;width:100%;max-width:1160px;margin:0 auto;
  padding:clamp(20px,3.2vh,44px) clamp(18px,4vw,44px) clamp(22px,3.4vh,46px);}
/* Rejilla pensada para caber en una pantalla: a la izquierda titular y
   garantías, a la derecha la consola y los pasos de la llamada.
   En una columna el orden cambia: titular · consola · garantías · pasos. */
.sp-split{display:grid;grid-template-columns:1.04fr .96fr;
  grid-template-areas:"intro panel" "support panel" "support steps";
  column-gap:clamp(28px,4.4vw,58px);row-gap:clamp(18px,2.4vh,26px);align-items:start;}
.sp-intro{grid-area:intro;}
.sp-support{grid-area:support;}
.sp-panel{grid-area:panel;}
.sp-steps{grid-area:steps;}
@media(max-width:940px){
  .sp-split{grid-template-columns:1fr;grid-template-areas:"intro" "panel" "support" "steps";row-gap:28px;}
}

/* Una sola vista cuando hay altura para ello. Por debajo de 760px de alto la
   página vuelve a hacer scroll: es preferible a recortar contenido. */
@media(min-width:941px) and (min-height:760px){
  .sp-root{height:100svh;overflow:hidden;}
  .sp-main{display:flex;flex-direction:column;justify-content:center;}
}

/* ── Columna de texto ── */
.sp-eyebrow{margin:0 0 clamp(10px,1.4vh,16px);font-size:.7rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--lime);}
.sp-title{margin:0;color:var(--hi);font-size:clamp(2rem,3.9vw,3.15rem);font-weight:660;line-height:1.05;letter-spacing:-.032em;}
/* El padding/margin compensados ensanchan la caja que pinta el degradado sin
   mover el texto: sin ellos, background-clip:text recorta el último glifo. */
.sp-title-hl{background:linear-gradient(180deg,var(--lime-br),var(--lime) 60%,var(--lime-dp) 135%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;
  padding-right:.08em;margin-right:-.08em;}
.sp-lead{margin:clamp(12px,1.6vh,18px) 0 0;max-width:46ch;font-size:clamp(.92rem,1.3vw,1.02rem);line-height:1.55;color:var(--tx);font-weight:420;}

/* Hechos: rejilla de datos, no bullets de marketing */
.sp-facts{display:grid;grid-template-columns:1fr 1fr;gap:1px;margin:0;padding:1px;
  background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden;}
@media(max-width:440px){.sp-facts{grid-template-columns:1fr;}}
.sp-fact{background:#070b0e;padding:clamp(10px,1.4vh,14px) 14px;}
.sp-fact dt{margin:0 0 5px;font-size:.66rem;font-weight:660;letter-spacing:.11em;text-transform:uppercase;color:var(--lime);}
.sp-fact dd{margin:0;font-size:.85rem;line-height:1.45;color:var(--hi);font-weight:430;}

.sp-note{margin:clamp(12px,1.8vh,18px) 0 0;max-width:58ch;font-size:.74rem;line-height:1.55;color:var(--dim);
  border-left:2px solid rgba(139,216,53,.34);padding-left:14px;}
.sp-note strong{color:var(--tx);font-weight:600;}

/* ── Panel de la consola ── */
.sp-panel{border:1px solid var(--line);border-radius:20px;background:
  linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012));
  backdrop-filter:blur(16px) saturate(140%);padding:14px;position:sticky;top:24px;}
@media(max-width:940px){.sp-panel{position:static;}}

.sp-seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:13px;
  background:rgba(0,0,0,.32);border:1px solid rgba(255,255,255,.055);}
.sp-seg-btn{appearance:none;border:none;background:transparent;color:var(--tx);font-family:inherit;
  font-size:.84rem;font-weight:560;letter-spacing:-.005em;padding:10px 8px;border-radius:10px;cursor:pointer;
  transition:background .25s var(--out),color .25s var(--out);}
.sp-seg-btn:hover{color:var(--hi);}
.sp-seg-btn.is-on{background:rgba(139,216,53,.14);color:var(--lime-br);box-shadow:inset 0 0 0 1px rgba(139,216,53,.3);}

.sp-console{display:flex;flex-direction:column;align-items:center;padding:clamp(14px,2.2vh,22px) 14px clamp(10px,1.6vh,16px);}
.sp-console-hint{margin:0 0 clamp(12px,2vh,20px);max-width:34ch;text-align:center;font-size:.82rem;line-height:1.5;color:var(--dim);}

/* ── Botón de llamada: contenido, sin pulso permanente ── */
.sp-orb{position:relative;width:clamp(96px,11vh,124px);height:clamp(96px,11vh,124px);border-radius:50%;border:none;background:none;padding:0;
  cursor:pointer;display:grid;place-items:center;-webkit-tap-highlight-color:transparent;
  transition:transform .4s var(--out);}
.sp-orb:hover{transform:scale(1.03);}
.sp-orb:active{transform:scale(.97);transition:transform .1s ease-out;}
.sp-orb:focus-visible{outline:2px solid var(--lime);outline-offset:9px;}
.sp-orb-core{position:relative;z-index:3;width:100%;height:100%;border-radius:50%;display:grid;place-items:center;color:#06120a;
  background:radial-gradient(120% 120% at 34% 26%,rgba(255,255,255,.82),rgba(255,255,255,0) 44%),
    radial-gradient(120% 120% at 50% 44%,var(--lime-br),var(--lime) 48%,var(--lime-dp) 98%);
  box-shadow:inset 0 2px 8px rgba(255,255,255,.45),inset 0 -12px 24px rgba(6,18,10,.5),
    0 14px 38px -14px rgba(139,216,53,.55);
  transition:box-shadow .45s var(--out);}
.sp-orb-ring{position:absolute;inset:-9px;border-radius:50%;border:1px solid rgba(139,216,53,.28);opacity:0;transition:opacity .35s var(--out);}
.sp-orb:hover .sp-orb-ring{opacity:1;}

.sp-orb-connecting .sp-orb-core{filter:saturate(.7);}
.sp-orb-connecting .sp-orb-ring{opacity:1;animation:sp-pulse 1.5s ease-out infinite;}
.sp-orb-live .sp-orb-ring{opacity:1;border-color:rgba(139,216,53,.6);animation:sp-pulse 2s ease-out infinite;}
.sp-orb-live .sp-orb-core{box-shadow:inset 0 2px 8px rgba(255,255,255,.5),inset 0 -12px 24px rgba(6,18,10,.45),0 18px 50px -12px rgba(139,216,53,.8);}
@keyframes sp-pulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.28);opacity:0}}

.sp-eq{display:flex;align-items:center;gap:4px;height:28px;}
.sp-eq span{display:block;width:4px;height:100%;border-radius:2px;background:#06120a;animation:sp-eq 1s ease-in-out infinite;}
@keyframes sp-eq{0%,100%{transform:scaleY(.32)}50%{transform:scaleY(1)}}
.sp-spin{width:24px;height:24px;border-radius:50%;border:3px solid rgba(6,18,10,.3);border-top-color:#06120a;animation:sp-spin .8s linear infinite;}
.sp-spin-sm{width:14px;height:14px;border-width:2px;}
@keyframes sp-spin{to{transform:rotate(360deg)}}

.sp-state{margin:clamp(12px,1.8vh,18px) 0 0;text-align:center;font-size:.92rem;font-weight:520;letter-spacing:-.008em;color:var(--tx);transition:color .3s var(--out);}
.sp-state-connecting,.sp-state-live{color:var(--lime-br);}
.sp-actions{display:flex;gap:10px;margin-top:18px;}

/* ── Botones ── */
.sp-btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;font-family:inherit;font-size:.9rem;
  font-weight:570;letter-spacing:-.008em;padding:12px 22px;border-radius:11px;border:none;cursor:pointer;
  transition:transform .25s var(--out),box-shadow .25s var(--out),background .25s;}
.sp-btn:active{transform:scale(.975);transition:transform .09s ease-out;}
.sp-btn-primary{background:var(--lime);color:#06120a;box-shadow:0 10px 26px -12px rgba(139,216,53,.6);}
.sp-btn-primary:hover{background:var(--lime-br);box-shadow:0 14px 32px -12px rgba(139,216,53,.7);}
.sp-btn-primary:disabled{opacity:.65;cursor:default;transform:none;}
.sp-btn-ghost{background:rgba(255,255,255,.05);color:var(--hi);border:1px solid var(--line);}
.sp-btn-ghost:hover{background:rgba(255,255,255,.09);}
.sp-btn-wide{width:100%;padding:14px;}

/* ── Formulario de teléfono ── */
.sp-form{display:flex;flex-direction:column;align-items:stretch;gap:12px;width:100%;max-width:330px;}
.sp-field{display:flex;width:100%;border-radius:12px;overflow:hidden;background:rgba(0,0,0,.3);border:1px solid var(--line);
  transition:border-color .25s var(--out),box-shadow .25s var(--out);}
.sp-field:focus-within{border-color:rgba(139,216,53,.5);box-shadow:0 0 0 3px rgba(139,216,53,.12);}
.sp-select{appearance:none;-webkit-appearance:none;background:transparent;border:none;border-right:1px solid var(--line);
  color:var(--hi);font-family:inherit;font-size:.86rem;padding:13px 12px;cursor:pointer;}
.sp-select option{background:#0b0f13;color:var(--hi);}
.sp-input{flex:1;min-width:0;background:transparent;border:none;color:var(--hi);font-family:inherit;font-size:1rem;
  letter-spacing:.02em;padding:13px 14px;}
.sp-input::placeholder{color:var(--dim);}
.sp-input:focus,.sp-select:focus{outline:none;}
.sp-fine{margin:2px 0 0;text-align:center;font-size:.71rem;line-height:1.5;color:var(--dim);}

.sp-ok{display:flex;flex-direction:column;align-items:center;gap:16px;}
.sp-ok-mark{width:60px;height:60px;border-radius:50%;display:grid;place-items:center;color:var(--lime-br);
  background:rgba(139,216,53,.12);border:1px solid rgba(139,216,53,.34);}
.sp-ok .sp-state{margin:0;}

.sp-err{margin:14px 0 0;max-width:36ch;text-align:center;font-size:.82rem;line-height:1.45;color:#ffb3a8;
  background:rgba(255,111,94,.08);border:1px solid rgba(255,111,94,.22);border-radius:10px;padding:10px 13px;}

/* ── Qué vas a escuchar ── */
.sp-steps{border-top:1px solid rgba(255,255,255,.06);padding-top:clamp(16px,2.2vh,22px);}
.sp-steps-h{margin:0 0 14px;font-size:.68rem;font-weight:660;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);}
.sp-steps-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px;}
.sp-steps-list li{display:flex;gap:11px;align-items:flex-start;font-size:.82rem;line-height:1.5;color:var(--tx);}
.sp-step-n{flex:none;font-size:.72rem;font-weight:700;letter-spacing:.06em;color:var(--lime);
  border:1px solid rgba(139,216,53,.3);border-radius:7px;padding:3px 7px;background:rgba(139,216,53,.07);}

/* ── Entrada ── */
.sp-enter{opacity:0;animation:sp-rise .75s var(--out) both;}
@keyframes sp-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}

@media(prefers-reduced-motion:reduce){
  .sp-aurora,.sp-badge-dot,.sp-orb-ring,.sp-eq span,.sp-spin{animation:none!important;}
  .sp-enter{animation:sp-fade .3s ease both;}
  @keyframes sp-fade{from{opacity:0}to{opacity:1}}
  .sp-orb:hover,.sp-orb:active,.sp-btn:active{transform:none;}
}
@media(prefers-reduced-transparency:reduce){
  .sp-panel{backdrop-filter:none;background:#0a0f13;}
}
`;
