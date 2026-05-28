'use client';

import { useRef, useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type RuleSet = {
  id: string;
  scope: 'GLOBAL' | 'TREATMENT';
  treatmentId: string | null;
  enabled: boolean;
  quietMode: 'SHIFT_INTO_HOURS' | 'SKIP';
};

type Rule = {
  id: string;
  ruleSetId: string;
  offsetMinutes: number;
  primaryChannel: 'WHATSAPP' | 'VOICE';
  fallbackChannel: 'WHATSAPP' | 'VOICE' | null;
  fallbackWindowHours: number | null;
  label: string | null;
  order: number;
  enabled: boolean;
};

type TemplateRow = {
  id: string;
  ruleId: string;
  channel: 'WHATSAPP' | 'VOICE';
  driverScope: string;
  templateName: string | null;
  templateLanguage: string;
  templateParamsMap: unknown;
  freeText: string | null;
  buttons: unknown;
  voicePromptOverride: string | null;
  enabled: boolean;
};

type Treatment = { id: string; name: string };
type WaMode = 'CLOUD' | 'EVOLUTION' | 'TWILIO';

export function RulesEditor(props: {
  initialRuleSets: RuleSet[];
  initialRules: Rule[];
  initialTemplates: TemplateRow[];
  treatments: Treatment[];
  activeWhatsAppMode: WaMode | null;
}) {
  const [ruleSets, setRuleSets] = useState(props.initialRuleSets);
  const [rules, setRules] = useState(props.initialRules);
  const [templates, setTemplates] = useState(props.initialTemplates);
  const [pending, startTransition] = useTransition();

  const global = ruleSets.find((r) => r.scope === 'GLOBAL') ?? null;

  async function createGlobal() {
    startTransition(async () => {
      const res = await fetch('/api/reminders/rule-sets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'GLOBAL' }),
      });
      if (res.ok) {
        const data = await res.json();
        setRuleSets((rs) => [...rs, data.ruleSet]);
      }
    });
  }

  async function addRule(ruleSetId: string) {
    startTransition(async () => {
      const res = await fetch('/api/reminders/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ruleSetId,
          offsetMinutes: 1440,
          primaryChannel: 'WHATSAPP',
          label: '24h antes',
          order: rules.filter((r) => r.ruleSetId === ruleSetId).length,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRules((r) => [...r, data.rule]);
      }
    });
  }

  async function patchRule(id: string, patch: Partial<Rule>) {
    startTransition(async () => {
      const res = await fetch(`/api/reminders/rules/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setRules((r) => r.map((x) => (x.id === id ? { ...x, ...data.rule } : x)));
      }
    });
  }

  async function deleteRule(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/reminders/rules/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setRules((r) => r.filter((x) => x.id !== id));
        setTemplates((t) => t.filter((x) => x.ruleId !== id));
      }
    });
  }

  async function upsertTemplate(ruleId: string, body: Partial<TemplateRow>) {
    startTransition(async () => {
      const existing = templates.find(
        (t) => t.ruleId === ruleId && t.driverScope === body.driverScope,
      );
      const url = existing ? `/api/reminders/templates/${existing.id}` : `/api/reminders/templates`;
      const method = existing ? 'PATCH' : 'POST';
      const payload = existing ? body : { ruleId, ...body };
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates((arr) => {
          const without = arr.filter((x) => x.id !== data.template.id);
          return [...without, data.template];
        });
      }
    });
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-2">Reglas globales</h2>
        {global ? (
          <RuleSetSection
            ruleSet={global}
            rules={rules.filter((r) => r.ruleSetId === global.id)}
            templates={templates}
            onAddRule={() => addRule(global.id)}
            onPatchRule={patchRule}
            onDeleteRule={deleteRule}
            onUpsertTemplate={upsertTemplate}
            pending={pending}
            activeWhatsAppMode={props.activeWhatsAppMode}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
            <p>Todavía no hay configuración global. Creala para arrancar.</p>
            <Button size="sm" className="mt-3" onClick={createGlobal} disabled={pending}>
              Crear set global
            </Button>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-zinc-700 mb-2">Overrides por tratamiento</h2>
        <p className="text-xs text-zinc-500 mb-2">
          Si querés reglas distintas para un tratamiento específico, créalas acá. Cuando una cita
          es de ese tratamiento, se usan estas reglas en lugar de las globales.
        </p>
        <TreatmentOverridesSection
          ruleSets={ruleSets}
          rules={rules}
          templates={templates}
          treatments={props.treatments}
          activeWhatsAppMode={props.activeWhatsAppMode}
          onCreateSet={(treatmentId) => {
            startTransition(async () => {
              const res = await fetch('/api/reminders/rule-sets', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ scope: 'TREATMENT', treatmentId }),
              });
              if (res.ok) {
                const data = await res.json();
                setRuleSets((rs) => [...rs, data.ruleSet]);
              }
            });
          }}
          onAddRule={addRule}
          onPatchRule={patchRule}
          onDeleteRule={deleteRule}
          onUpsertTemplate={upsertTemplate}
          pending={pending}
        />
      </section>
    </div>
  );
}

function RuleSetSection(props: {
  ruleSet: RuleSet;
  rules: Rule[];
  templates: TemplateRow[];
  onAddRule: () => void;
  onPatchRule: (id: string, patch: Partial<Rule>) => void;
  onDeleteRule: (id: string) => void;
  onUpsertTemplate: (ruleId: string, body: Partial<TemplateRow>) => void;
  pending: boolean;
  activeWhatsAppMode: WaMode | null;
}) {
  return (
    <div className="space-y-3">
      {props.rules.length === 0 ? (
        <Card className="p-4 text-sm text-zinc-500">
          Sin reglas. Añadí la primera para programar recordatorios.
        </Card>
      ) : (
        props.rules.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            templates={props.templates.filter((t) => t.ruleId === r.id)}
            onPatch={(p) => props.onPatchRule(r.id, p)}
            onDelete={() => props.onDeleteRule(r.id)}
            onUpsertTemplate={(body) => props.onUpsertTemplate(r.id, body)}
            pending={props.pending}
            activeWhatsAppMode={props.activeWhatsAppMode}
          />
        ))
      )}
      <Button size="sm" variant="secondary" onClick={props.onAddRule} disabled={props.pending}>
        + Añadir regla
      </Button>
    </div>
  );
}

function RuleRow(props: {
  rule: Rule;
  templates: TemplateRow[];
  onPatch: (p: Partial<Rule>) => void;
  onDelete: () => void;
  onUpsertTemplate: (body: Partial<TemplateRow>) => void;
  pending: boolean;
  activeWhatsAppMode: WaMode | null;
}) {
  const [showTemplates, setShowTemplates] = useState(false);
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <input
          type="text"
          defaultValue={props.rule.label ?? ''}
          placeholder="Etiqueta (ej: 24h antes)"
          onBlur={(e) => props.onPatch({ label: e.target.value || null })}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm w-full md:w-44"
        />
        <OffsetPicker
          totalMinutes={props.rule.offsetMinutes}
          onChange={(m) => props.onPatch({ offsetMinutes: m })}
          disabled={props.pending}
        />
        <select
          defaultValue={props.rule.primaryChannel}
          onChange={(e) =>
            props.onPatch({ primaryChannel: e.target.value as 'WHATSAPP' | 'VOICE' })
          }
          className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
        >
          <option value="WHATSAPP">WhatsApp</option>
          <option value="VOICE">Voz</option>
        </select>
        <select
          defaultValue={props.rule.fallbackChannel ?? ''}
          onChange={(e) => {
            const v = e.target.value as '' | 'WHATSAPP' | 'VOICE';
            props.onPatch({
              fallbackChannel: v === '' ? null : v,
              fallbackWindowHours: v === '' ? null : props.rule.fallbackWindowHours ?? 1,
            });
          }}
          className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
        >
          <option value="">Sin fallback</option>
          <option value="WHATSAPP">Fallback WA</option>
          <option value="VOICE">Fallback voz</option>
        </select>
        {props.rule.fallbackChannel && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              defaultValue={props.rule.fallbackWindowHours ?? 1}
              min={1}
              max={72}
              onBlur={(e) =>
                props.onPatch({
                  fallbackWindowHours: Math.max(1, Math.min(72, Number.parseInt(e.target.value, 10) || 1)),
                })
              }
              className="w-16 rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
            />
            <span className="text-xs text-zinc-500">h de espera</span>
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowTemplates((v) => !v)}
            disabled={props.pending}
          >
            Plantillas ({props.templates.length})
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onDelete} disabled={props.pending}>
            Borrar
          </Button>
        </div>
      </div>

      {showTemplates && (
        <div className="mt-3 border-t border-zinc-100 pt-3 space-y-3">
          <TemplateEditor
            rule={props.rule}
            templates={props.templates}
            onUpsert={props.onUpsertTemplate}
            pending={props.pending}
            activeWhatsAppMode={props.activeWhatsAppMode}
          />
        </div>
      )}
    </Card>
  );
}

// Selector de offset: días + horas combinables. Internamente se guarda en
// minutos (1 día = 1440 min, 1 hora = 60 min). Se puede usar solo días, solo
// horas, o ambos. El total debe ser ≥ 1 minuto.
function OffsetPicker({
  totalMinutes,
  onChange,
  disabled,
}: {
  totalMinutes: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
}) {
  const initialDays = Math.floor(totalMinutes / 1440);
  const initialHours = Math.floor((totalMinutes % 1440) / 60);
  const [days, setDays] = useState<number>(initialDays);
  const [hours, setHours] = useState<number>(initialHours);

  function commit(nextDays: number, nextHours: number) {
    const safeDays = Math.max(0, Math.min(60, nextDays || 0));
    const safeHours = Math.max(0, Math.min(23, nextHours || 0));
    const total = safeDays * 1440 + safeHours * 60;
    if (total < 1) return;
    setDays(safeDays);
    setHours(safeHours);
    if (total !== totalMinutes) onChange(total);
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        value={days}
        min={0}
        max={60}
        onChange={(e) => setDays(Number.parseInt(e.target.value, 10) || 0)}
        onBlur={() => commit(days, hours)}
        disabled={disabled}
        className="w-14 rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-right"
      />
      <span className="text-xs text-zinc-500">d</span>
      <input
        type="number"
        value={hours}
        min={0}
        max={23}
        onChange={(e) => setHours(Number.parseInt(e.target.value, 10) || 0)}
        onBlur={() => commit(days, hours)}
        disabled={disabled}
        className="w-14 rounded-md border border-zinc-200 px-2 py-1.5 text-sm text-right"
      />
      <span className="text-xs text-zinc-500">h antes</span>
    </div>
  );
}

const DRIVERS: { value: string; label: string; channel: 'WHATSAPP' | 'VOICE' }[] = [
  { value: 'whatsapp_cloud', label: 'WhatsApp Cloud (Meta)', channel: 'WHATSAPP' },
  { value: 'whatsapp_twilio', label: 'WhatsApp Twilio', channel: 'WHATSAPP' },
  { value: 'whatsapp_evolution', label: 'WhatsApp Evolution', channel: 'WHATSAPP' },
  { value: 'voice_retell', label: 'Voz Retell', channel: 'VOICE' },
];

// Variables disponibles para interpolar en plantillas. Se muestran siempre
// visibles para que el operador pueda insertarlas sin memorizarlas.
const REMINDER_VARIABLES: Array<{ token: string; description: string }> = [
  { token: '{{contact.firstName}}', description: 'Nombre del paciente' },
  { token: '{{contact.fullName}}', description: 'Nombre completo del paciente' },
  { token: '{{contact.phone}}', description: 'Teléfono del paciente' },
  { token: '{{appointment.date}}', description: 'Fecha (ej: "lunes, 25 de mayo de 2026")' },
  { token: '{{appointment.time}}', description: 'Hora (ej: "10:30")' },
  { token: '{{appointment.dateTime}}', description: 'Fecha + hora completa' },
  { token: '{{appointment.treatment}}', description: 'Tratamiento (ej: "Limpieza dental")' },
  { token: '{{appointment.durationMinutes}}', description: 'Duración en minutos' },
  { token: '{{clinic.name}}', description: 'Nombre de la clínica' },
  { token: '{{clinic.address}}', description: 'Dirección de la clínica' },
  { token: '{{clinic.phone}}', description: 'Teléfono de la clínica' },
];

function driversAvailableForRule(
  rule: Rule,
  activeWaMode: WaMode | null,
): { value: string; label: string; channel: 'WHATSAPP' | 'VOICE' }[] {
  const channels = new Set<'WHATSAPP' | 'VOICE'>();
  channels.add(rule.primaryChannel);
  if (rule.fallbackChannel) channels.add(rule.fallbackChannel);

  const result: { value: string; label: string; channel: 'WHATSAPP' | 'VOICE' }[] = [];
  if (channels.has('WHATSAPP') && activeWaMode) {
    const map: Record<WaMode, { value: string; label: string }> = {
      CLOUD: { value: 'whatsapp_cloud', label: 'WhatsApp Cloud (Meta)' },
      EVOLUTION: { value: 'whatsapp_evolution', label: 'WhatsApp Evolution' },
      TWILIO: { value: 'whatsapp_twilio', label: 'WhatsApp Twilio' },
    };
    const entry = map[activeWaMode];
    result.push({ ...entry, channel: 'WHATSAPP' });
  }
  if (channels.has('VOICE')) {
    result.push({ value: 'voice_retell', label: 'Voz Retell', channel: 'VOICE' });
  }
  return result;
}

function TemplateEditor(props: {
  rule: Rule;
  templates: TemplateRow[];
  onUpsert: (body: Partial<TemplateRow>) => void;
  pending: boolean;
  activeWhatsAppMode: WaMode | null;
}) {
  const available = driversAvailableForRule(props.rule, props.activeWhatsAppMode);
  const [selectedDriver, setSelectedDriver] = useState<string>(
    available[0]?.value ?? 'whatsapp_evolution',
  );
  const driverChannel = available.find((d) => d.value === selectedDriver)?.channel ?? 'WHATSAPP';
  const current = props.templates.find((t) => t.driverScope === selectedDriver) ?? null;
  const [freeText, setFreeText] = useState(current?.freeText ?? '');
  const [templateName, setTemplateName] = useState(current?.templateName ?? '');
  const [voicePrompt, setVoicePrompt] = useState(current?.voicePromptOverride ?? '');
  const [previewText, setPreviewText] = useState<string>('');
  const [testPhone, setTestPhone] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastDriver = useRef(selectedDriver);

  // Cuando cambia el driver seleccionado, resetear el form con los valores
  // del template existente para ese driver (si existe).
  if (lastDriver.current !== selectedDriver) {
    lastDriver.current = selectedDriver;
    const next = props.templates.find((t) => t.driverScope === selectedDriver) ?? null;
    setFreeText(next?.freeText ?? '');
    setTemplateName(next?.templateName ?? '');
    setVoicePrompt(next?.voicePromptOverride ?? '');
  }

  function insertVariable(token: string) {
    const target =
      driverChannel === 'VOICE'
        ? { value: voicePrompt, setter: setVoicePrompt }
        : { value: freeText, setter: setFreeText };
    const ta = textareaRef.current;
    if (!ta) {
      target.setter((v) => `${v}${token}`);
      return;
    }
    const start = ta.selectionStart ?? target.value.length;
    const end = ta.selectionEnd ?? target.value.length;
    const next = target.value.slice(0, start) + token + target.value.slice(end);
    target.setter(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function loadPreview() {
    const res = await fetch('/api/reminders/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ruleId: props.rule.id }),
    });
    if (res.ok) {
      const data = await res.json();
      setPreviewText(data.renderedText ?? '(sin contenido)');
    } else {
      const data = await res.json().catch(() => ({}));
      setPreviewText(`(error: ${data.error ?? 'desconocido'})`);
    }
  }

  async function testSend() {
    if (!testPhone) return;
    const res = await fetch('/api/reminders/test-send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ruleId: props.rule.id, toPhoneE164: testPhone }),
    });
    const data = await res.json().catch(() => ({}));
    alert(
      res.ok && data.ok !== false
        ? `Test enviado: ${JSON.stringify(data)}`
        : `Error: ${data.error ?? 'desconocido'}`,
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {available.length > 1 ? (
          <select
            value={selectedDriver}
            onChange={(e) => setSelectedDriver(e.target.value)}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
          >
            {available.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700">
            {available[0]?.label ?? 'Sin driver disponible'}
          </span>
        )}
        <Badge tone={current ? 'success' : 'neutral'}>
          {current ? 'Configurada' : 'No configurada'}
        </Badge>
        {!props.activeWhatsAppMode && driverChannel === 'WHATSAPP' && (
          <span className="text-xs text-amber-600">
            ⚠ Conecta WhatsApp en /dashboard/whatsapp para habilitar esta plantilla.
          </span>
        )}
      </div>

      {/* Panel de variables siempre visible */}
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
        <p className="mb-2 text-xs font-medium text-zinc-700">
          Variables disponibles{' '}
          <span className="font-normal text-zinc-500">(click para insertar)</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {REMINDER_VARIABLES.map((v) => (
            <button
              key={v.token}
              type="button"
              onClick={() => insertVariable(v.token)}
              title={v.description}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 font-mono text-[11px] text-zinc-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
            >
              {v.token}
            </button>
          ))}
        </div>
      </div>

      {driverChannel === 'WHATSAPP' && selectedDriver !== 'whatsapp_evolution' && (
        <input
          type="text"
          placeholder="Nombre de plantilla aprobada (ej: dental_reminder_24h)"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          className="w-full rounded-md border border-zinc-200 px-3 py-1.5 text-sm"
        />
      )}

      {driverChannel === 'WHATSAPP' && selectedDriver === 'whatsapp_evolution' && (
        <textarea
          ref={textareaRef}
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={4}
          placeholder="Hola {{contact.firstName}}, te recordamos tu cita de {{appointment.treatment}} {{appointment.dateTime}}."
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm font-mono"
        />
      )}

      {driverChannel === 'VOICE' && (
        <textarea
          ref={textareaRef}
          value={voicePrompt}
          onChange={(e) => setVoicePrompt(e.target.value)}
          rows={3}
          placeholder="Mensaje inicial del agente (opcional)."
          className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() =>
            props.onUpsert({
              channel: driverChannel,
              driverScope: selectedDriver as never,
              templateName: templateName || null,
              freeText: freeText || null,
              voicePromptOverride: voicePrompt || null,
            })
          }
          disabled={props.pending}
        >
          Guardar plantilla
        </Button>
        <Button size="sm" variant="secondary" onClick={loadPreview}>
          Previsualizar
        </Button>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="+34..."
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            className="w-32 rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
          />
          <Button size="sm" variant="secondary" onClick={testSend} disabled={!testPhone}>
            Enviar prueba
          </Button>
        </div>
      </div>

      {previewText && (
        <Card className="p-3 bg-emerald-50 border-emerald-200">
          <p className="text-xs text-emerald-700 font-medium mb-1">Vista previa:</p>
          <pre className="whitespace-pre-wrap text-sm text-zinc-800 font-sans">{previewText}</pre>
        </Card>
      )}
    </div>
  );
}

function TreatmentOverridesSection(props: {
  ruleSets: RuleSet[];
  rules: Rule[];
  templates: TemplateRow[];
  treatments: Treatment[];
  onCreateSet: (treatmentId: string) => void;
  onAddRule: (ruleSetId: string) => void;
  onPatchRule: (id: string, patch: Partial<Rule>) => void;
  onDeleteRule: (id: string) => void;
  onUpsertTemplate: (ruleId: string, body: Partial<TemplateRow>) => void;
  pending: boolean;
  activeWhatsAppMode: WaMode | null;
}) {
  const treatmentSets = props.ruleSets.filter((r) => r.scope === 'TREATMENT');
  const usedTreatmentIds = new Set(treatmentSets.map((r) => r.treatmentId));
  const available = props.treatments.filter((t) => !usedTreatmentIds.has(t.id));

  return (
    <div className="space-y-4">
      {treatmentSets.map((rs) => {
        const treatment = props.treatments.find((t) => t.id === rs.treatmentId);
        return (
          <div key={rs.id}>
            <h3 className="text-sm font-medium text-zinc-700 mb-2">
              {treatment?.name ?? `Treatment ${rs.treatmentId}`}
            </h3>
            <RuleSetSection
              ruleSet={rs}
              rules={props.rules.filter((r) => r.ruleSetId === rs.id)}
              templates={props.templates}
              onAddRule={() => props.onAddRule(rs.id)}
              onPatchRule={props.onPatchRule}
              onDeleteRule={props.onDeleteRule}
              onUpsertTemplate={props.onUpsertTemplate}
              pending={props.pending}
              activeWhatsAppMode={props.activeWhatsAppMode}
            />
          </div>
        );
      })}

      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            id="addOverride"
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm"
            defaultValue=""
          >
            <option value="" disabled>
              Seleccionar tratamiento…
            </option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const el = document.getElementById('addOverride') as HTMLSelectElement | null;
              if (el?.value) props.onCreateSet(el.value);
            }}
          >
            + Crear override
          </Button>
        </div>
      )}
    </div>
  );
}
