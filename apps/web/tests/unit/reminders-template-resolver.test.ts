import { describe, expect, it } from 'vitest';

import {
  defaultReminderButtons,
  driverScopeForWhatsAppMode,
  resolveTemplate,
  type ReminderTemplateRow,
} from '@/lib/reminders/template-resolver';

function tpl(overrides: Partial<ReminderTemplateRow>): ReminderTemplateRow {
  return {
    id: 'tpl1',
    ruleId: 'rule1',
    channel: 'WHATSAPP',
    driverScope: 'whatsapp_cloud',
    templateName: null,
    templateLanguage: 'es',
    templateParamsMap: [],
    freeText: null,
    buttons: [],
    voicePromptOverride: null,
    enabled: true,
    ...overrides,
  };
}

describe('driverScopeForWhatsAppMode', () => {
  it('mapea cada modo a su driverScope', () => {
    expect(driverScopeForWhatsAppMode('CLOUD')).toBe('whatsapp_cloud');
    expect(driverScopeForWhatsAppMode('EVOLUTION')).toBe('whatsapp_evolution');
    expect(driverScopeForWhatsAppMode('TWILIO')).toBe('whatsapp_twilio');
  });
});

describe('resolveTemplate', () => {
  it('match exacto por canal + driverScope', () => {
    const templates = [
      tpl({ id: 'cloud', driverScope: 'whatsapp_cloud' }),
      tpl({ id: 'evo', driverScope: 'whatsapp_evolution' }),
    ];
    const r = resolveTemplate(templates, 'WHATSAPP', 'whatsapp_evolution');
    expect(r?.id).toBe('evo');
  });

  it('no hay match exacto pero canal WA → fallback a primer template del canal', () => {
    const templates = [tpl({ id: 'evo', driverScope: 'whatsapp_evolution' })];
    const r = resolveTemplate(templates, 'WHATSAPP', 'whatsapp_cloud');
    expect(r?.id).toBe('evo');
  });

  it('canal VOICE sin match → null', () => {
    const templates = [tpl({ id: 'cloud', driverScope: 'whatsapp_cloud' })];
    const r = resolveTemplate(templates, 'VOICE', 'voice_retell');
    expect(r).toBeNull();
  });

  it('ignora templates disabled', () => {
    const templates = [
      tpl({ id: 'cloud', driverScope: 'whatsapp_cloud', enabled: false }),
      tpl({ id: 'evo', driverScope: 'whatsapp_evolution' }),
    ];
    const r = resolveTemplate(templates, 'WHATSAPP', 'whatsapp_cloud');
    expect(r?.id).toBe('evo'); // fallback porque el match exacto está disabled
  });

  it('no hay templates → null', () => {
    const r = resolveTemplate([], 'WHATSAPP', 'whatsapp_cloud');
    expect(r).toBeNull();
  });
});

describe('defaultReminderButtons', () => {
  it('genera 3 botones con ids rem:<action>:<id>', () => {
    const btns = defaultReminderButtons('xyz');
    expect(btns).toEqual([
      { id: 'rem:confirm:xyz', title: 'Confirmar' },
      { id: 'rem:reschedule:xyz', title: 'Reagendar' },
      { id: 'rem:cancel:xyz', title: 'Cancelar' },
    ]);
  });
});
