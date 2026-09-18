'use client';

import { useEffect, useRef, useState } from 'react';

// Prefijos ofrecidos en el selector. El backend (allowlist) es la autoridad;
// esto es solo comodidad de UI. España primero por ser el mercado del piloto.
const PREFIXES = [
  { code: '+34', label: 'España +34' },
  { code: '+351', label: 'Portugal +351' },
  { code: '+54', label: 'Argentina +54' },
  { code: '+52', label: 'México +52' },
  { code: '+57', label: 'Colombia +57' },
  { code: '+56', label: 'Chile +56' },
  { code: '+51', label: 'Perú +51' },
  { code: '+598', label: 'Uruguay +598' },
];

type Status = 'idle' | 'loading' | 'success' | 'error';
type WebStatus = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export function SapinnDemo() {
  // 'web' = hablar con el agente por el navegador (WebRTC, sin telefonía).
  // 'phone' = que el agente llame a un teléfono (depende de la línea saliente).
  const [mode, setMode] = useState<'web' | 'phone'>('web');
  const [prefix, setPrefix] = useState('+34');
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [webStatus, setWebStatus] = useState<WebStatus>('idle');
  const [webMsg, setWebMsg] = useState('');
  const clientRef = useRef<{ stopCall?: () => void } | null>(null);

  // Corta la llamada web si el usuario se va de la página con ella activa.
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
        body: JSON.stringify({ name: name.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        accessToken?: string;
        error?: string;
      };
      if (!res.ok || !data.accessToken) {
        setWebStatus('error');
        setWebMsg(data.error ?? 'No pudimos iniciar la prueba. Probá de nuevo en un momento.');
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
        setWebMsg('Se cortó la llamada. Probá otra vez.');
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
          ? 'Necesitamos permiso del micrófono para que hables con el agente.'
          : 'No pudimos conectar. Revisá tu conexión y probá otra vez.',
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
      setMessage('Escribí tu número sin el prefijo del país, solo los dígitos.');
      return;
    }
    setStatus('loading');
    setMessage('');
    try {
      const res = await fetch('/api/public/demo-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `${prefix}${digits}`, name: name.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (res.ok && data.ok) {
        setStatus('success');
        setMessage(data.message ?? 'Te estamos llamando ahora. Atendé tu teléfono.');
      } else {
        setStatus('error');
        setMessage(data.error ?? 'No pudimos disparar la llamada. Probá de nuevo en un momento.');
      }
    } catch {
      setStatus('error');
      setMessage('No pudimos conectar. Revisá tu conexión y probá otra vez.');
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
        ? 'Te escucho — hablá con normalidad'
        : webStatus === 'ended'
          ? 'Llamada terminada'
          : 'Tocá para hablar';

  return (
    <div className="sp-root">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: hoja de estilos estática de la página */}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="sp-bg" aria-hidden="true">
        <div className="sp-aurora sp-aurora-a" />
        <div className="sp-aurora sp-aurora-b" />
        <div className="sp-grid" />
        <div className="sp-vignette" />
      </div>

      <header className="sp-bar">
        <div className="sp-lockup">
          Futura <span>×</span> Sapinn
        </div>
        <div className="sp-ref">SPN-2026-VOZ-01</div>
      </header>

      <main className="sp-stage">
        <p className="sp-eyebrow sp-enter" style={{ animationDelay: '.05s' }}>
          <span className="sp-eye-dot" /> Asistente de voz · Español de España
        </p>
        <h1 className="sp-title sp-enter" style={{ animationDelay: '.14s' }}>
          Hablá con el agente.
        </h1>
        <p className="sp-sub sp-enter" style={{ animationDelay: '.22s' }}>
          {mode === 'web'
            ? 'Le hablás con tu voz, aquí mismo. Se presenta, entiende y responde en tiempo real. Interrumpilo cuando quieras.'
            : 'Dejá tu número y el agente te llama en menos de un minuto.'}
        </p>

        {mode === 'web' ? (
          <div className="sp-console sp-enter" style={{ animationDelay: '.32s' }}>
            <button
              type="button"
              className={`sp-orb sp-orb-${orbState}`}
              onClick={webStatus === 'live' ? endWebCall : startWebCall}
              aria-label={webStatus === 'live' ? 'Cortar la llamada' : 'Hablar con el agente'}
            >
              <span className="sp-orb-ring sp-orb-ring-1" />
              <span className="sp-orb-ring sp-orb-ring-2" />
              <span className="sp-orb-ring sp-orb-ring-3" />
              <span className="sp-orb-core">
                {webStatus === 'live' ? (
                  <span className="sp-orb-eq" aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={`b-${i}`} style={{ animationDelay: `${i * 0.14}s` }} />
                    ))}
                  </span>
                ) : webStatus === 'connecting' ? (
                  <span className="sp-orb-spin" aria-hidden="true" />
                ) : (
                  <MicIcon />
                )}
              </span>
            </button>

            <p className={`sp-orb-label sp-orb-label-${orbState}`}>{orbLabel}</p>

            <div className="sp-actions">
              {webStatus === 'live' && (
                <button type="button" className="sp-btn sp-btn-hang" onClick={endWebCall}>
                  Cortar
                </button>
              )}
              {(webStatus === 'ended' || webStatus === 'error') && (
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
              )}
            </div>

            {webStatus === 'error' && <p className="sp-err">{webMsg}</p>}

            {(webStatus === 'idle' || webStatus === 'ended') && (
              <button type="button" className="sp-switch" onClick={() => setMode('phone')}>
                o que te llame al teléfono
              </button>
            )}
          </div>
        ) : (
          <div className="sp-console sp-enter" style={{ animationDelay: '.32s' }}>
            {status !== 'success' ? (
              <form onSubmit={submit} className="sp-phoneform">
                <div className="sp-glass sp-field-row">
                  <select
                    value={prefix}
                    onChange={(ev) => setPrefix(ev.target.value)}
                    className="sp-select"
                    disabled={status === 'loading'}
                    aria-label="País"
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
                    aria-label="Tu número"
                  />
                </div>
                <button
                  type="submit"
                  className="sp-btn sp-btn-primary"
                  disabled={status === 'loading'}
                >
                  {status === 'loading' ? (
                    <>
                      <span className="sp-mini-spin" /> Llamando…
                    </>
                  ) : (
                    <>
                      <PhoneIcon /> Que me llame
                    </>
                  )}
                </button>
                {status === 'error' && <p className="sp-err">{message}</p>}
                <button type="button" className="sp-switch" onClick={() => setMode('web')}>
                  mejor hablar ahora con mi voz
                </button>
              </form>
            ) : (
              <div className="sp-phone-ok">
                <div className="sp-orb sp-orb-live" aria-hidden="true">
                  <span className="sp-orb-ring sp-orb-ring-1" />
                  <span className="sp-orb-ring sp-orb-ring-2" />
                  <span className="sp-orb-core">
                    <PhoneIcon />
                  </span>
                </div>
                <p className="sp-orb-label sp-orb-label-live">Te estamos llamando</p>
                <p className="sp-sub" style={{ marginTop: 0 }}>
                  {message}
                </p>
                <button
                  type="button"
                  className="sp-switch"
                  onClick={() => {
                    setStatus('idle');
                    setMessage('');
                    setNumber('');
                  }}
                >
                  probar con otro número
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="sp-foot">Futura Solutions · Respuesta a la consulta · Confidencial</footer>
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="30"
      height="30"
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
  --bg:#05080b;--bg2:#080c10;--line:rgba(255,255,255,.08);
  --lime:#8bd835;--lime-br:#a8ec5c;--lime-dp:#3f6b1e;
  --hi:#f3f7f2;--tx:#9aa8a2;--dim:#5f6d67;
  --spring:cubic-bezier(.34,1.4,.64,1);--out:cubic-bezier(.22,1,.36,1);
  position:relative;min-height:100svh;background:var(--bg);color:var(--tx);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;overflow-x:hidden;
  display:flex;flex-direction:column;
}
.sp-root *{box-sizing:border-box;}

/* ── Fondo ── */
.sp-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:radial-gradient(120% 80% at 50% -10%,#0a1310 0%,var(--bg) 55%);}
.sp-aurora{position:absolute;border-radius:50%;filter:blur(90px);opacity:.55;mix-blend-mode:screen;}
.sp-aurora-a{width:60vw;height:60vw;max-width:720px;max-height:720px;background:radial-gradient(circle,rgba(139,216,53,.5),transparent 62%);top:-14%;left:50%;transform:translateX(-50%);animation:sp-drift-a 22s ease-in-out infinite;}
.sp-aurora-b{width:52vw;height:52vw;max-width:640px;max-height:640px;background:radial-gradient(circle,rgba(63,120,40,.55),transparent 60%);bottom:-22%;left:24%;animation:sp-drift-b 28s ease-in-out infinite;}
@keyframes sp-drift-a{0%,100%{transform:translateX(-50%) translateY(0) scale(1)}50%{transform:translateX(-46%) translateY(28px) scale(1.06)}}
@keyframes sp-drift-b{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(40px,-24px) scale(1.08)}}
.sp-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(90% 70% at 50% 30%,#000 20%,transparent 75%);}
.sp-vignette{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 40%,transparent 55%,rgba(0,0,0,.55));}

/* ── Barra superior (material translúcido) ── */
.sp-bar{position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center;gap:12px;
  padding:16px clamp(18px,4vw,40px);}
.sp-lockup{font-size:.8rem;font-weight:600;letter-spacing:.01em;color:var(--hi);}
.sp-lockup span{color:var(--lime);margin:0 5px;font-weight:500;}
.sp-ref{font-size:.62rem;font-weight:600;letter-spacing:.18em;color:var(--dim);text-transform:uppercase;}

/* ── Escenario centrado ── */
.sp-stage{position:relative;z-index:2;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  padding:clamp(20px,5vh,56px) 20px;gap:0;}

.sp-eyebrow{display:inline-flex;align-items:center;gap:9px;margin:0 0 22px;font-size:.72rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--lime);}
.sp-eye-dot{width:6px;height:6px;border-radius:50%;background:var(--lime);box-shadow:0 0 12px var(--lime);animation:sp-blink 2.4s ease-in-out infinite;}
@keyframes sp-blink{0%,100%{opacity:1}50%{opacity:.35}}

.sp-title{margin:0;color:var(--hi);font-size:clamp(2.6rem,7vw,4.6rem);font-weight:640;line-height:1.02;letter-spacing:-.035em;font-optical-sizing:auto;}
.sp-sub{margin:20px auto 0;max-width:46ch;color:var(--tx);font-size:clamp(1rem,1.7vw,1.14rem);line-height:1.55;font-weight:420;letter-spacing:-.006em;}

/* ── Consola ── */
.sp-console{margin-top:clamp(30px,5vh,52px);display:flex;flex-direction:column;align-items:center;}

/* ── Orbe ── */
.sp-orb{position:relative;width:clamp(184px,42vw,236px);height:clamp(184px,42vw,236px);border-radius:50%;border:none;background:none;padding:0;cursor:pointer;
  display:grid;place-items:center;-webkit-tap-highlight-color:transparent;
  animation:sp-breathe 6s ease-in-out infinite;transition:transform .5s var(--spring),filter .5s var(--out);}
.sp-orb:focus-visible{outline:2px solid var(--lime);outline-offset:10px;border-radius:50%;}
.sp-orb:hover{transform:scale(1.035);}
.sp-orb:active{transform:scale(.965);transition:transform .12s ease-out;}
@keyframes sp-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.028)}}

.sp-orb-core{position:relative;z-index:3;width:70%;height:70%;border-radius:50%;display:grid;place-items:center;color:#06120a;
  background:
    radial-gradient(120% 120% at 32% 26%,rgba(255,255,255,.9),rgba(255,255,255,0) 42%),
    radial-gradient(120% 120% at 50% 42%,var(--lime-br),var(--lime) 46%,var(--lime-dp) 96%);
  box-shadow:
    inset 0 2px 10px rgba(255,255,255,.55),
    inset 0 -16px 30px rgba(6,18,10,.55),
    0 20px 50px -14px rgba(139,216,53,.6),
    0 0 0 1px rgba(139,216,53,.35);
  transition:box-shadow .5s var(--out),transform .5s var(--spring);}
.sp-orb-core::after{content:"";position:absolute;inset:0;border-radius:50%;
  background:conic-gradient(from 0deg,transparent,rgba(255,255,255,.5),transparent 40%);
  mix-blend-mode:overlay;opacity:.6;animation:sp-sheen 5s linear infinite;}
@keyframes sp-sheen{to{transform:rotate(360deg)}}

.sp-orb-ring{position:absolute;inset:0;border-radius:50%;border:1px solid rgba(139,216,53,.4);opacity:0;}
.sp-orb-idle .sp-orb-ring,.sp-orb-ended .sp-orb-ring{animation:sp-halo 3.4s ease-out infinite;}
.sp-orb-idle .sp-orb-ring-2,.sp-orb-ended .sp-orb-ring-2{animation-delay:1.1s;}
.sp-orb-idle .sp-orb-ring-3,.sp-orb-ended .sp-orb-ring-3{animation-delay:2.2s;}
@keyframes sp-halo{0%{transform:scale(.82);opacity:.6}100%{transform:scale(1.5);opacity:0}}

/* Conectando: pulso más nervioso y núcleo atenuado */
.sp-orb-connecting{animation:none;}
.sp-orb-connecting .sp-orb-ring{animation:sp-halo 1.5s ease-out infinite;}
.sp-orb-connecting .sp-orb-ring-2{animation-delay:.5s;}
.sp-orb-connecting .sp-orb-ring-3{animation-delay:1s;}
.sp-orb-spin{width:26px;height:26px;border-radius:50%;border:3px solid rgba(6,18,10,.35);border-top-color:#06120a;animation:sp-spin .8s linear infinite;}
@keyframes sp-spin{to{transform:rotate(360deg)}}

/* En vivo: halo continuo brillante + ecualizador */
.sp-orb-live{animation:sp-breathe-live 2.6s ease-in-out infinite;}
@keyframes sp-breathe-live{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
.sp-orb-live .sp-orb-core{box-shadow:inset 0 2px 10px rgba(255,255,255,.6),inset 0 -16px 30px rgba(6,18,10,.5),0 24px 64px -12px rgba(139,216,53,.85),0 0 0 1px rgba(139,216,53,.55);}
.sp-orb-live .sp-orb-ring{animation:sp-halo 2s ease-out infinite;border-color:rgba(139,216,53,.7);}
.sp-orb-live .sp-orb-ring-2{animation-delay:.66s;}
.sp-orb-live .sp-orb-ring-3{animation-delay:1.33s;}
.sp-orb-eq{display:flex;align-items:center;gap:5px;height:34px;}
.sp-orb-eq span{display:block;width:5px;height:100%;border-radius:3px;background:#06120a;transform-origin:center;animation:sp-eq 1s ease-in-out infinite;}
@keyframes sp-eq{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}

.sp-orb-label{margin:26px 0 0;font-size:1.02rem;font-weight:520;letter-spacing:-.01em;color:var(--hi);transition:color .4s var(--out);}
.sp-orb-label-idle{color:var(--tx);}
.sp-orb-label-connecting{color:var(--lime);}
.sp-orb-label-live{color:var(--lime);}

.sp-actions{display:flex;gap:10px;margin-top:20px;min-height:0;}

/* ── Botones ── */
.sp-btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;font-family:inherit;font-size:.98rem;font-weight:560;letter-spacing:-.01em;
  padding:13px 24px;border-radius:999px;border:none;cursor:pointer;transition:transform .3s var(--spring),box-shadow .3s var(--out),background .3s;}
.sp-btn:active{transform:scale(.96);transition:transform .1s ease-out;}
.sp-btn-primary{background:var(--lime);color:#06120a;box-shadow:0 14px 34px -12px rgba(139,216,53,.6);}
.sp-btn-primary:hover{transform:translateY(-1px);box-shadow:0 20px 44px -14px rgba(139,216,53,.72);}
.sp-btn-primary:disabled{opacity:.7;cursor:default;transform:none;}
.sp-btn-hang{background:rgba(255,255,255,.06);color:var(--hi);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(14px);}
.sp-btn-hang:hover{background:rgba(255,111,94,.14);border-color:rgba(255,111,94,.4);color:#ffb3a8;}

.sp-switch{margin-top:26px;background:none;border:none;color:var(--dim);font-family:inherit;font-size:.86rem;letter-spacing:-.005em;cursor:pointer;transition:color .3s var(--out);padding:6px;}
.sp-switch:hover{color:var(--lime);}

.sp-err{margin:16px 0 0;max-width:34ch;font-size:.86rem;line-height:1.45;color:#ffb3a8;background:rgba(255,111,94,.08);border:1px solid rgba(255,111,94,.22);border-radius:12px;padding:11px 14px;}

/* ── Modo teléfono ── */
.sp-phoneform{display:flex;flex-direction:column;align-items:center;gap:14px;width:min(340px,88vw);}
.sp-glass{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(18px) saturate(150%);}
.sp-field-row{display:flex;width:100%;border-radius:16px;overflow:hidden;}
.sp-select{appearance:none;-webkit-appearance:none;background:transparent;border:none;border-right:1px solid rgba(255,255,255,.1);color:var(--hi);font-family:inherit;font-size:.96rem;padding:15px 14px;cursor:pointer;}
.sp-select option{background:#0b0f13;color:var(--hi);}
.sp-input{flex:1;min-width:0;background:transparent;border:none;color:var(--hi);font-family:inherit;font-size:1.05rem;letter-spacing:.02em;padding:15px 16px;}
.sp-input::placeholder{color:var(--dim);}
.sp-input:focus,.sp-select:focus{outline:none;}
.sp-field-row:focus-within{border-color:rgba(139,216,53,.5);box-shadow:0 0 0 3px rgba(139,216,53,.14);}
.sp-phoneform .sp-btn-primary{width:100%;padding:15px;}
.sp-mini-spin{width:15px;height:15px;border-radius:50%;border:2px solid rgba(6,18,10,.35);border-top-color:#06120a;animation:sp-spin .7s linear infinite;}
.sp-phone-ok{display:flex;flex-direction:column;align-items:center;}

/* ── Pie ── */
.sp-foot{position:relative;z-index:2;text-align:center;padding:20px;font-size:.68rem;letter-spacing:.04em;color:var(--dim);}

/* ── Entrada orquestada (materializa: blur+scale+fade) ── */
.sp-enter{opacity:0;animation:sp-materialize .9s var(--out) both;}
@keyframes sp-materialize{from{opacity:0;transform:translateY(14px) scale(.985);filter:blur(8px)}to{opacity:1;transform:none;filter:blur(0)}}

@media(prefers-reduced-motion:reduce){
  .sp-aurora,.sp-eye-dot,.sp-orb,.sp-orb-core::after,.sp-orb-ring,.sp-orb-eq span,.sp-orb-spin,.sp-orb-live{animation:none!important;}
  .sp-enter{animation:sp-fade .3s ease both;}
  @keyframes sp-fade{from{opacity:0}to{opacity:1}}
  .sp-orb:hover,.sp-orb:active{transform:none;}
}
@media(prefers-reduced-transparency:reduce){
  .sp-glass,.sp-btn-hang{backdrop-filter:none;background:#0c1116;}
}
`;
