'use client';

import { saveInvoiceSettingsAction } from '@/app/(dashboard)/dashboard/finanzas/actions';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import type { InvoiceSettingsRecord } from '@/lib/invoices/service';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

type Form = {
  issuerName: string;
  issuerSubtitle: string;
  taxId: string;
  address: string;
  email: string;
  phone: string;
  iban: string;
  logoUrl: string;
  tagline: string;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
  vatRate: string;
  vatNote: string;
  defaultConcept: string;
  seriesYear: string;
  nextNumber: string;
};

function fromRecord(r: InvoiceSettingsRecord | null, year: number): Form {
  return {
    issuerName: r?.issuerName ?? '',
    issuerSubtitle: r?.issuerSubtitle ?? '',
    taxId: r?.taxId ?? '',
    address: r?.address ?? '',
    email: r?.email ?? '',
    phone: r?.phone ?? '',
    iban: r?.iban ?? '',
    logoUrl: r?.logoUrl ?? '',
    tagline: r?.tagline ?? '',
    footerLeft: r?.footerLeft ?? '',
    footerCenter: r?.footerCenter ?? '',
    footerRight: r?.footerRight ?? '',
    vatRate: String(r?.vatRate ?? 0),
    vatNote: r?.vatNote ?? '',
    defaultConcept: r?.defaultConcept ?? '',
    seriesYear: String(r?.seriesYear ?? year),
    nextNumber: String(r?.nextNumber ?? 1),
  };
}

/**
 * Los datos que van impresos en cada factura (emisor, NIF, dirección, IBAN,
 * logo, IVA, pie) y el contador de la serie. Se guardan con el botón: es un
 * formulario largo y aquí conviene revisar antes.
 */
export function InvoiceSettingsForm({
  settings,
  year,
}: { settings: InvoiceSettingsRecord | null; year: number }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState<Form>(() => fromRecord(settings, year));
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  function set<K extends keyof Form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await saveInvoiceSettingsAction({
        issuerName: form.issuerName,
        issuerSubtitle: form.issuerSubtitle,
        taxId: form.taxId,
        address: form.address,
        email: form.email,
        phone: form.phone,
        iban: form.iban,
        logoUrl: form.logoUrl,
        tagline: form.tagline,
        footerLeft: form.footerLeft,
        footerCenter: form.footerCenter,
        footerRight: form.footerRight,
        vatRate: Number(form.vatRate),
        vatNote: form.vatNote,
        defaultConcept: form.defaultConcept,
        seriesYear: form.seriesYear.trim() ? Number(form.seriesYear) : null,
        nextNumber: Number(form.nextNumber),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  const field = (
    key: keyof Form,
    label: string,
    opts: { placeholder?: string; type?: string; hint?: string; span?: boolean } = {},
  ) => (
    <div className={opts.span ? 'flex flex-col gap-1.5 sm:col-span-2' : 'flex flex-col gap-1.5'}>
      <Label htmlFor={`inv-set-${key}`}>{label}</Label>
      <Input
        id={`inv-set-${key}`}
        type={opts.type ?? 'text'}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={opts.placeholder}
        className="placeholder:text-zinc-400/80"
      />
      {opts.hint && <p className="text-[12px] text-zinc-600">{opts.hint}</p>}
    </div>
  );

  return (
    <form
      className="flex flex-col gap-5 p-4 sm:p-6 sm:pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <section className="grid gap-3 sm:grid-cols-2">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-700 sm:col-span-2">
          Emisor
        </h3>
        {field('issuerName', 'Nombre', { placeholder: 'Ej.: Raquel Pinto Egea' })}
        {field('issuerSubtitle', 'Título o colegiación', {
          placeholder: 'Ej.: Fisioterapeuta · Colegiada nº 10.751',
        })}
        {field('taxId', 'NIF', { placeholder: 'Ej.: 05442362X' })}
        {field('phone', 'Teléfono', { placeholder: 'Ej.: 676 790 181' })}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-set-address">Dirección</Label>
          <Textarea
            id="inv-set-address"
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
            className="min-h-[72px]"
            placeholder={'Ej.: Av. de Carmen Martín Gaite, 17\n28919 Leganés, Madrid'}
          />
          <p className="text-[12px] text-zinc-600">Una línea por renglón, como va impresa.</p>
        </div>
        {field('email', 'Correo', { type: 'email', placeholder: 'Ej.: respinens@gmail.com' })}
        {field('iban', 'IBAN', {
          placeholder: 'Ej.: ES12 3456 7890 1234 5678 9012',
          hint: 'Sólo se imprime cuando la forma de pago es transferencia.',
        })}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-700 sm:col-span-2">
          Marca
        </h3>
        {field('logoUrl', 'Logo (URL https)', {
          placeholder: 'https://…/logo.png',
          hint: 'PNG o JPG. Sin logo, va el nombre del emisor.',
          span: true,
        })}
        {field('tagline', 'Lema bajo el logo', {
          placeholder: 'Ej.: Fisioterapia respiratoria pediátrica',
        })}
        {field('defaultConcept', 'Concepto por defecto de una sesión', {
          placeholder: 'Ej.: Sesión de fisioterapia respiratoria pediátrica',
          hint: 'Si está vacío, se usa el nombre del tratamiento.',
        })}
        {field('footerLeft', 'Pie · izquierda', {
          placeholder: 'Ej.: Respinens · Fisioterapia respiratoria pediátrica',
        })}
        {field('footerCenter', 'Pie · centro', { placeholder: 'Ej.: Centro autorizado CS17385' })}
        {field('footerRight', 'Pie · derecha', { placeholder: 'Ej.: www.respinens.es' })}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-700 sm:col-span-2">
          Impuestos y numeración
        </h3>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-set-vat">IVA</Label>
          <Select
            id="inv-set-vat"
            value={form.vatRate}
            onChange={(e) => set('vatRate', e.target.value)}
          >
            <option value="0">Exento (0 %)</option>
            <option value="4">4 %</option>
            <option value="10">10 %</option>
            <option value="21">21 %</option>
          </Select>
          <p className="text-[12px] text-zinc-600">
            La sanidad va exenta (art. 20 de la Ley 37/1992).
          </p>
        </div>
        {field('vatNote', 'Observación fiscal', {
          placeholder: 'Ej.: Operación exenta por el art. 20 de la Ley 37/1992 del IVA',
          hint: 'Se imprime en Observaciones cuando el IVA es 0.',
        })}
        {field('seriesYear', 'Año de la serie', {
          type: 'number',
          hint: 'Cambia solo cuando emites la primera factura de un año.',
        })}
        {field('nextNumber', 'Próximo número', {
          type: 'number',
          hint: 'Se asigna al emitir. Cámbialo sólo para continuar una serie que ya existía (por ejemplo 33 si la última fue 2026-0000032).',
        })}
      </section>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{' '}
          Guardar datos de facturación
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-700">
            <Check className="h-3.5 w-3.5" /> Guardado
          </span>
        )}
      </div>
    </form>
  );
}
