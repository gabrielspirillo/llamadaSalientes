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

export function SapinnDemo() {
  const [prefix, setPrefix] = useState('+34');
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // Revelado por scroll con IntersectionObserver: sin dependencias de
  // animación. Si no hay JS o el usuario prefiere menos movimiento, el CSS
  // deja todo visible igual.
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll('[data-reveal]');
    if (!els?.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('sp-in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.16 },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);

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
        body: JSON.stringify({
          phone: `${prefix}${digits}`,
          name: name.trim() || undefined,
        }),
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

  function reset() {
    setStatus('idle');
    setMessage('');
    setNumber('');
  }

  return (
    <div ref={rootRef} className="sp-root">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: hoja de estilos estática de la página */}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Fondos ambientales */}
      <div className="sp-bg" aria-hidden="true">
        <div className="sp-grid" />
        <div className="sp-orb sp-orb-a" />
        <div className="sp-orb sp-orb-b" />
      </div>

      <main className="sp-wrap">
        {/* ── Encabezado ── */}
        <header className="sp-head">
          <div className="sp-lockup">
            Futura Solutions <span>&times;</span> Sapinn
          </div>
          <div className="sp-ref">SPN-2026-VOZ-01</div>
        </header>

        {/* ── Hero ── */}
        <section className="sp-hero">
          <div className="sp-eyebrow">
            <span className="sp-dot" /> Prueba en vivo · español de España
          </div>
          <h1 className="sp-h1">
            Poné tu número.
            <br />
            El agente <em>te llama</em>.
          </h1>
          <p className="sp-lead">
            En menos de un minuto suena tu teléfono. Se presenta como sistema de IA, habla en
            castellano y hace el guion de la propuesta. Interrumpilo, ponele pegas y colgá cuando
            quieras: eso es lo que ningún audio grabado te muestra.
          </p>

          {/* ── Tarjeta de llamada ── */}
          <div className={`sp-card sp-card-${status}`}>
            {status !== 'success' ? (
              <form onSubmit={submit} className="sp-form">
                <div className="sp-field-row">
                  <label className="sp-field sp-field-prefix">
                    <span className="sp-lbl">País</span>
                    <select
                      value={prefix}
                      onChange={(ev) => setPrefix(ev.target.value)}
                      className="sp-select"
                      disabled={status === 'loading'}
                    >
                      {PREFIXES.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="sp-field sp-field-num">
                    <span className="sp-lbl">Tu número</span>
                    <input
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="600 000 000"
                      value={number}
                      onChange={(ev) => setNumber(ev.target.value)}
                      className="sp-input"
                      disabled={status === 'loading'}
                    />
                  </label>
                </div>

                <label className="sp-field">
                  <span className="sp-lbl">
                    Tu nombre <em>opcional</em>
                  </span>
                  <input
                    autoComplete="name"
                    placeholder="Para que el agente te salude"
                    value={name}
                    onChange={(ev) => setName(ev.target.value)}
                    className="sp-input"
                    disabled={status === 'loading'}
                  />
                </label>

                <button type="submit" className="sp-btn" disabled={status === 'loading'}>
                  {status === 'loading' ? (
                    <>
                      <span className="sp-spinner" /> Llamando...
                    </>
                  ) : (
                    <>
                      <PhoneIcon /> Que me llame ahora
                    </>
                  )}
                </button>

                {status === 'error' && <p className="sp-msg sp-msg-err">{message}</p>}

                <p className="sp-fineprint">
                  Sin registro y sin coste para vos. Usamos tu número solo para esta llamada de
                  prueba.
                </p>
              </form>
            ) : (
              <div className="sp-success">
                <div className="sp-phone" aria-hidden="true">
                  <span className="sp-ring sp-ring-1" />
                  <span className="sp-ring sp-ring-2" />
                  <span className="sp-phone-core">
                    <PhoneIcon />
                  </span>
                </div>
                <h2 className="sp-success-h">Te estamos llamando</h2>
                <p className="sp-success-p">{message}</p>
                <button type="button" className="sp-btn sp-btn-ghost" onClick={reset}>
                  Probar con otro número
                </button>
              </div>
            )}
          </div>

          <div className="sp-microsteps">
            <div data-reveal>
              <span className="sp-num">1</span> Ponés tu número
            </div>
            <div data-reveal>
              <span className="sp-num">2</span> Suena en menos de 1 min
            </div>
            <div data-reveal>
              <span className="sp-num">3</span> Hablás y colgás
            </div>
          </div>
        </section>

        {/* ── Qué es ── */}
        <section className="sp-section" data-reveal>
          <div className="sp-tag">La propuesta, en corto</div>
          <h2 className="sp-h2">
            Un agente que llama a las farmacias que hoy <em>no llama nadie</em>.
          </h2>
          <div className="sp-cards3">
            <article className="sp-mini">
              <div className="sp-mini-fig">1.591</div>
              <p>
                farmacias en Castilla y León sin delegado ni cobertura telefónica. Ahí empieza el
                piloto.
              </p>
            </article>
            <article className="sp-mini">
              <div className="sp-mini-fig">4</div>
              <p>
                salidas por llamada: agenda con el comercial, catálogo, visita del delegado o
                pedido. Y todo no registrado por motivo.
              </p>
            </article>
            <article className="sp-mini">
              <div className="sp-mini-fig">&lt;1 min</div>
              <p>
                es lo que tarda en sonar tu teléfono cuando dejás el número aquí arriba. La misma
                tecnología que haría las llamadas reales.
              </p>
            </article>
          </div>
        </section>

        {/* ── Qué vas a oír ── */}
        <section className="sp-section" data-reveal>
          <div className="sp-tag">Qué vas a oír</div>
          <div className="sp-listen">
            <div className="sp-wave" aria-hidden="true">
              {WAVE.map((h, i) => (
                <span
                  key={`w-${i}-${h}`}
                  style={{ height: `${h}%`, animationDelay: `${i * 0.06}s` }}
                />
              ))}
            </div>
            <ul className="sp-checks">
              <li>Se presenta como sistema de IA en la primera frase.</li>
              <li>Verifica con quién habla antes de proponer nada.</li>
              <li>Propone agendar una llamada con una persona del equipo.</li>
              <li>Si le decís que no, pide el motivo y cuelga sin insistir.</li>
            </ul>
          </div>
        </section>

        {/* ── Cómo trabaja ── */}
        <section className="sp-section" data-reveal>
          <div className="sp-tag">Cómo trabaja</div>
          <h2 className="sp-h2">
            Cuatro movimientos en <em>una sola llamada</em>.
          </h2>
          <div className="sp-steps4">
            <article>
              <span className="sp-step-n">01</span>
              <h3>Se identifica</h3>
              <p>Dice que es un sistema de IA y de parte de quién llama.</p>
            </article>
            <article>
              <span className="sp-step-n">02</span>
              <h3>Sitúa el motivo</h3>
              <p>Una frase que se entienda con un cliente delante del mostrador.</p>
            </article>
            <article>
              <span className="sp-step-n">03</span>
              <h3>Propone</h3>
              <p>Agenda con el comercial, catálogo por correo o visita del delegado.</p>
            </article>
            <article>
              <span className="sp-step-n">04</span>
              <h3>Cierra y anota</h3>
              <p>Confirma en voz y deja el resultado tipificado en el registro.</p>
            </article>
          </div>
        </section>

        {/* ── Fases ── */}
        <section className="sp-section" data-reveal>
          <div className="sp-tag">Del piloto al despliegue</div>
          <h2 className="sp-h2">
            Cinco fases, con un <em>freno de verdad</em> en la segunda.
          </h2>
          <ol className="sp-timeline">
            <li>
              <span className="sp-tl-dot" />
              <div>
                <div className="sp-tl-top">
                  <b>Descubrimiento</b>
                  <span>1–2 sem</span>
                </div>
                <p>
                  Qué sistemas hay, dónde vive la agenda del comercial y qué base jurídica ampara la
                  campaña.
                </p>
              </div>
            </li>
            <li>
              <span className="sp-tl-dot" />
              <div>
                <div className="sp-tl-top">
                  <b>Prueba de voz</b>
                  <span>2–3 sem</span>
                </div>
                <p>
                  Llamadas reales a números de prueba. Si la voz no aguanta una conversación de
                  mostrador, el proyecto para aquí.
                </p>
              </div>
            </li>
            <li>
              <span className="sp-tl-dot" />
              <div>
                <div className="sp-tl-top">
                  <b>Piloto medido</b>
                  <span>6–8 sem</span>
                </div>
                <p>
                  Entre 300 y 500 farmacias de Castilla y León, con panel de resultados y mejora del
                  guion.
                </p>
              </div>
            </li>
            <li>
              <span className="sp-tl-dot" />
              <div>
                <div className="sp-tl-top">
                  <b>Despliegue</b>
                  <span>8–10 sem</span>
                </div>
                <p>
                  Castilla y León completa, y después las cuatro comunidades que hoy se cubren a
                  mano.
                </p>
              </div>
            </li>
            <li>
              <span className="sp-tl-dot" />
              <div>
                <div className="sp-tl-top">
                  <b>Operación</b>
                  <span>mensual</span>
                </div>
                <p>Escuchar llamadas, ajustar guion y objeciones, y vigilar la numeración.</p>
              </div>
            </li>
          </ol>
        </section>

        {/* ── El registro ── */}
        <section className="sp-section" data-reveal>
          <div className="sp-tag">Lo que queda de cada llamada</div>
          <h2 className="sp-h2">
            No una transcripción. Un <em>registro que se puede leer</em>.
          </h2>
          <div className="sp-record">
            <p className="sp-rec-lead">
              Cuando la farmacia dice que no, el agente pide el motivo y lo clasifica. Así se ve,
              sobre un piloto de ejemplo, por qué dijeron que no:
            </p>
            <div className="sp-bars">
              <div className="sp-bar">
                <span className="k">Ya trabajan la marca</span>
                <span className="t">
                  <i style={{ width: '100%' }} />
                </span>
                <span className="n">61</span>
              </div>
              <div className="sp-bar">
                <span className="k">Sin hueco de lineal</span>
                <span className="t">
                  <i style={{ width: '72%' }} />
                </span>
                <span className="n">44</span>
              </div>
              <div className="sp-bar">
                <span className="k">Compran por cooperativa</span>
                <span className="t">
                  <i style={{ width: '62%' }} />
                </span>
                <span className="n">38</span>
              </div>
              <div className="sp-bar">
                <span className="k">Prefieren al delegado</span>
                <span className="t">
                  <i style={{ width: '43%' }} />
                </span>
                <span className="n">26</span>
              </div>
            </div>
            <p className="sp-rec-foot">
              Saber que 38 farmacias compran por cooperativa no es una métrica: es información
              comercial que cambia dónde poner al próximo delegado.
            </p>
          </div>
        </section>

        {/* ── Cierre ── */}
        <section className="sp-cta-final" data-reveal>
          <h2>¿Querés oírlo?</h2>
          <p>Subí, dejá tu número y en menos de un minuto lo tenés al teléfono.</p>
          <button
            type="button"
            className="sp-btn"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <PhoneIcon /> Que me llame ahora
          </button>
        </section>

        <footer className="sp-foot">
          <span>Futura Solutions</span>
          <span>Respuesta a la consulta SPN-2026-VOZ-01 · Confidencial</span>
        </footer>
      </main>
    </div>
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
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 11.5a16 16 0 0 0 6 6l1-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2Z" />
    </svg>
  );
}

const WAVE = [30, 62, 45, 80, 40, 70, 34, 90, 50, 66, 38, 78, 44, 60, 30, 84, 48, 72, 36, 58];

const CSS = `
.sp-root{--base:#04070a;--surf:#090d10;--surf2:#0d1114;--line:#1a2220;--lime:#8bd835;--lime-deep:#2f4a1d;--white:#fefefe;--text:#b7c2bc;--dim:#7c8a85;--faint:#5c6a66;
  position:relative;min-height:100vh;background:var(--base);color:var(--text);
  font-family:"Figtree",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  overflow-x:hidden;-webkit-font-smoothing:antialiased;}
.sp-root *{box-sizing:border-box;}

.sp-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;}
.sp-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(139,216,53,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(139,216,53,.035) 1px,transparent 1px);background-size:52px 52px;mask-image:radial-gradient(120% 90% at 50% 0%,#000 30%,transparent 78%);}
.sp-orb{position:absolute;border-radius:50%;filter:blur(70px);opacity:.5;}
.sp-orb-a{width:520px;height:520px;background:radial-gradient(circle,rgba(139,216,53,.42),transparent 66%);top:-160px;right:-120px;animation:sp-float-a 15s ease-in-out infinite;}
.sp-orb-b{width:440px;height:440px;background:radial-gradient(circle,rgba(58,120,60,.5),transparent 66%);bottom:-160px;left:-120px;animation:sp-float-b 19s ease-in-out infinite;}
@keyframes sp-float-a{0%,100%{transform:translate(0,0)}50%{transform:translate(-40px,50px)}}
@keyframes sp-float-b{0%,100%{transform:translate(0,0)}50%{transform:translate(50px,-40px)}}

.sp-wrap{position:relative;z-index:1;max-width:60rem;margin:0 auto;padding:24px 20px 64px;}

.sp-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-bottom:10px;border-bottom:1px solid rgba(139,216,53,.1);}
.sp-lockup{font-size:.72rem;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--white);}
.sp-lockup span{color:var(--lime);padding:0 5px;}
.sp-ref{font-size:.62rem;font-weight:600;letter-spacing:.16em;color:var(--faint);text-transform:uppercase;}

.sp-hero{padding-top:clamp(34px,7vw,72px);text-align:center;}
.sp-eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:.68rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--lime);border:1px solid rgba(139,216,53,.25);border-radius:999px;padding:7px 15px;background:rgba(139,216,53,.05);animation:sp-fade .7s ease both;}
.sp-dot{width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 0 0 rgba(139,216,53,.6);animation:sp-pulse 1.8s ease-out infinite;}
@keyframes sp-pulse{0%{box-shadow:0 0 0 0 rgba(139,216,53,.55)}70%{box-shadow:0 0 0 9px rgba(139,216,53,0)}100%{box-shadow:0 0 0 0 rgba(139,216,53,0)}}

.sp-h1{margin:22px auto 0;color:var(--white);font-size:clamp(2.3rem,7vw,4rem);font-weight:800;line-height:1.04;letter-spacing:-.035em;max-width:16ch;text-wrap:balance;animation:sp-rise .8s .05s ease both;}
.sp-h1 em{font-style:italic;color:var(--lime);}
.sp-lead{margin:20px auto 0;max-width:54ch;color:var(--text);font-size:1.04rem;line-height:1.6;animation:sp-rise .8s .12s ease both;}

.sp-card{margin:34px auto 0;max-width:32rem;background:linear-gradient(180deg,rgba(13,17,20,.9),rgba(9,13,16,.92));border:1px solid var(--line);border-radius:20px;padding:26px;text-align:left;box-shadow:0 30px 70px -30px rgba(0,0,0,.8),0 0 0 1px rgba(139,216,53,.04) inset;animation:sp-rise .8s .2s ease both;position:relative;}
.sp-card::before{content:"";position:absolute;inset:0;border-radius:20px;padding:1px;background:linear-gradient(140deg,rgba(139,216,53,.35),transparent 40%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;}

.sp-form{display:flex;flex-direction:column;gap:14px;}
.sp-field-row{display:grid;grid-template-columns:minmax(0,10rem) 1fr;gap:12px;}
@media(max-width:440px){.sp-field-row{grid-template-columns:1fr;}}
.sp-field{display:flex;flex-direction:column;gap:6px;}
.sp-lbl{font-size:.62rem;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--dim);}
.sp-lbl em{color:var(--faint);font-style:normal;font-weight:600;text-transform:none;letter-spacing:0;}
.sp-select,.sp-input{width:100%;background:var(--surf2);border:1px solid var(--line);border-radius:12px;padding:13px 15px;color:var(--white);font-size:1rem;font-family:inherit;transition:border-color .18s,box-shadow .18s;}
.sp-select{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237c8a85' stroke-width='3'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:36px;}
.sp-input::placeholder{color:var(--faint);}
.sp-select:focus,.sp-input:focus{outline:none;border-color:var(--lime);box-shadow:0 0 0 3px rgba(139,216,53,.16);}

.sp-btn{margin-top:4px;display:inline-flex;align-items:center;justify-content:center;gap:10px;background:var(--lime);color:#06120a;font-weight:800;font-size:1.02rem;font-family:inherit;letter-spacing:-.01em;padding:15px 22px;border:none;border-radius:13px;cursor:pointer;transition:transform .15s,box-shadow .2s,filter .2s;box-shadow:0 12px 30px -10px rgba(139,216,53,.5);}
.sp-btn:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.05);box-shadow:0 16px 40px -12px rgba(139,216,53,.6);}
.sp-btn:active:not(:disabled){transform:translateY(0);}
.sp-btn:disabled{cursor:default;opacity:.85;}
.sp-btn-ghost{background:transparent;color:var(--lime);border:1px solid rgba(139,216,53,.4);box-shadow:none;}
.sp-btn-ghost:hover:not(:disabled){background:rgba(139,216,53,.08);filter:none;}

.sp-spinner{width:16px;height:16px;border:2px solid rgba(6,18,10,.35);border-top-color:#06120a;border-radius:50%;animation:sp-spin .7s linear infinite;}
@keyframes sp-spin{to{transform:rotate(360deg)}}

.sp-msg{margin:0;font-size:.86rem;line-height:1.45;}
.sp-msg-err{color:#ff9d90;background:rgba(255,111,94,.08);border:1px solid rgba(255,111,94,.25);border-radius:10px;padding:11px 13px;}
.sp-fineprint{margin:2px 0 0;font-size:.74rem;color:var(--faint);line-height:1.5;}

.sp-success{text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;padding:8px 0;}
.sp-phone{position:relative;width:78px;height:78px;display:grid;place-items:center;margin-bottom:8px;}
.sp-phone-core{width:60px;height:60px;border-radius:50%;background:var(--lime);color:#06120a;display:grid;place-items:center;animation:sp-shake 1s ease-in-out infinite;}
.sp-phone-core svg{width:26px;height:26px;}
.sp-ring{position:absolute;inset:0;border-radius:50%;border:2px solid var(--lime);opacity:0;animation:sp-ripple 1.8s ease-out infinite;}
.sp-ring-2{animation-delay:.6s;}
@keyframes sp-ripple{0%{transform:scale(.7);opacity:.7}100%{transform:scale(1.6);opacity:0}}
@keyframes sp-shake{0%,100%{transform:rotate(0)}20%{transform:rotate(-14deg)}40%{transform:rotate(12deg)}60%{transform:rotate(-8deg)}80%{transform:rotate(6deg)}}
.sp-success-h{margin:4px 0 0;color:var(--white);font-size:1.4rem;font-weight:800;letter-spacing:-.02em;}
.sp-success-p{margin:0;color:var(--text);font-size:.95rem;max-width:34ch;}
.sp-success .sp-btn{margin-top:12px;}

.sp-microsteps{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 26px;margin-top:26px;}
.sp-microsteps div{display:inline-flex;align-items:center;gap:9px;font-size:.85rem;color:var(--dim);}
.sp-num{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:rgba(139,216,53,.12);color:var(--lime);font-weight:800;font-size:.78rem;}

.sp-section{margin-top:clamp(56px,10vw,96px);}
.sp-tag{font-size:.62rem;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--lime);}
.sp-h2{margin:12px 0 0;color:var(--white);font-size:clamp(1.5rem,3.6vw,2rem);font-weight:800;line-height:1.16;letter-spacing:-.022em;max-width:22ch;text-wrap:balance;}
.sp-h2 em{font-style:italic;color:var(--lime);}

.sp-cards3{display:grid;gap:14px;margin-top:26px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));}
.sp-mini{background:var(--surf);border:1px solid var(--line);border-radius:16px;padding:22px;transition:transform .2s,border-color .2s;}
.sp-mini:hover{transform:translateY(-3px);border-color:rgba(139,216,53,.3);}
.sp-mini-fig{color:var(--lime);font-size:2.2rem;font-weight:800;letter-spacing:-.03em;line-height:1;}
.sp-mini p{margin:12px 0 0;font-size:.9rem;line-height:1.55;}

.sp-listen{display:grid;gap:26px;margin-top:24px;align-items:center;grid-template-columns:1fr;}
@media(min-width:640px){.sp-listen{grid-template-columns:auto 1fr;}}
.sp-wave{display:flex;align-items:center;gap:4px;height:88px;padding:0 4px;}
.sp-wave span{display:block;width:5px;border-radius:3px;background:linear-gradient(180deg,var(--lime),var(--lime-deep));animation:sp-eq 1.1s ease-in-out infinite;transform-origin:center;}
@keyframes sp-eq{0%,100%{transform:scaleY(.5)}50%{transform:scaleY(1)}}
.sp-checks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;}
.sp-checks li{position:relative;padding-left:26px;font-size:.94rem;color:var(--text);line-height:1.5;}
.sp-checks li::before{content:"";position:absolute;left:0;top:.36em;width:14px;height:14px;border-radius:50%;background:rgba(139,216,53,.15);}
.sp-checks li::after{content:"";position:absolute;left:5px;top:calc(.36em + 3px);width:4px;height:7px;border-right:2px solid var(--lime);border-bottom:2px solid var(--lime);transform:rotate(42deg);}

.sp-steps4{display:grid;gap:12px;margin-top:24px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));}
.sp-steps4 article{background:var(--surf);border:1px solid var(--line);border-radius:14px;padding:20px;transition:transform .2s,border-color .2s;}
.sp-steps4 article:hover{transform:translateY(-3px);border-color:rgba(139,216,53,.3);}
.sp-step-n{color:var(--lime);font-weight:800;font-size:.8rem;letter-spacing:.1em;}
.sp-steps4 h3{margin:10px 0 6px;color:var(--white);font-size:1rem;font-weight:700;}
.sp-steps4 p{margin:0;font-size:.86rem;line-height:1.5;color:var(--dim);}

.sp-timeline{list-style:none;margin:26px 0 0;padding:0;position:relative;}
.sp-timeline::before{content:"";position:absolute;left:6px;top:8px;bottom:8px;width:2px;background:linear-gradient(var(--lime),var(--lime-deep));}
.sp-timeline li{position:relative;padding:0 0 22px 30px;}
.sp-timeline li:last-child{padding-bottom:0;}
.sp-tl-dot{position:absolute;left:0;top:4px;width:14px;height:14px;border-radius:50%;background:var(--base);border:2px solid var(--lime);box-shadow:0 0 0 4px rgba(139,216,53,.08);}
.sp-tl-top{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;}
.sp-tl-top b{color:var(--white);font-size:.98rem;font-weight:700;}
.sp-tl-top span{font-size:.7rem;color:var(--lime);font-weight:700;letter-spacing:.06em;text-transform:uppercase;}
.sp-timeline p{margin:5px 0 0;font-size:.86rem;line-height:1.5;color:var(--dim);max-width:58ch;}

.sp-record{margin-top:22px;background:var(--surf);border:1px solid var(--line);border-radius:16px;padding:22px;}
.sp-rec-lead{margin:0 0 16px;font-size:.92rem;color:var(--text);max-width:60ch;}
.sp-bars{display:flex;flex-direction:column;gap:11px;}
.sp-bar{display:grid;grid-template-columns:1fr 2.2rem;gap:6px 14px;align-items:center;}
@media(min-width:560px){.sp-bar{grid-template-columns:11rem 1fr 2.2rem;}}
.sp-bar .k{font-size:.84rem;color:var(--text);}
.sp-bar .t{height:9px;background:#101714;border-radius:4px;overflow:hidden;}
.sp-bar .t i{display:block;height:100%;background:linear-gradient(90deg,var(--lime-deep),var(--lime));border-radius:4px;transform:scaleX(0);transform-origin:left;transition:transform 1s cubic-bezier(.2,.7,.2,1);}
.sp-in .sp-bar .t i{transform:scaleX(1);}
.sp-bar .n{text-align:right;color:var(--white);font-weight:700;font-size:.85rem;font-variant-numeric:tabular-nums;}
@media(max-width:559px){.sp-bar .t{grid-column:1/-1;}}
.sp-rec-foot{margin:16px 0 0;padding-top:14px;border-top:1px solid var(--line);font-size:.85rem;color:var(--dim);max-width:60ch;}

.sp-cta-final{margin-top:clamp(56px,10vw,90px);text-align:center;border:1px solid rgba(139,216,53,.22);border-radius:20px;padding:44px 24px;background:radial-gradient(130% 110% at 50% 0%,rgba(139,216,53,.09),transparent 68%);}
.sp-cta-final h2{margin:0;color:var(--white);font-size:clamp(1.5rem,4vw,2.1rem);font-weight:800;letter-spacing:-.022em;}
.sp-cta-final p{margin:12px auto 22px;max-width:42ch;color:var(--text);}
.sp-cta-final .sp-btn{display:inline-flex;}

.sp-foot{margin-top:clamp(56px,10vw,90px);padding-top:18px;border-top:1px solid rgba(139,216,53,.1);display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:space-between;font-size:.7rem;color:var(--faint);letter-spacing:.04em;}
.sp-foot span:first-child{color:var(--white);font-weight:700;letter-spacing:.1em;text-transform:uppercase;}

[data-reveal]{opacity:0;transform:translateY(22px);transition:opacity .7s ease,transform .7s ease;}
[data-reveal].sp-in{opacity:1;transform:none;}
.sp-microsteps [data-reveal]{transition-delay:.05s;}
.sp-microsteps [data-reveal]:nth-child(2){transition-delay:.13s;}
.sp-microsteps [data-reveal]:nth-child(3){transition-delay:.21s;}

@keyframes sp-fade{from{opacity:0}to{opacity:1}}
@keyframes sp-rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}

@media(prefers-reduced-motion:reduce){
  .sp-orb,.sp-dot,.sp-phone-core,.sp-ring,.sp-wave span{animation:none!important;}
  .sp-h1,.sp-lead,.sp-card,.sp-eyebrow{animation:none!important;}
  .sp-bar .t i{transform:none!important;transition:none!important;}
  [data-reveal]{opacity:1!important;transform:none!important;}
}
`;
