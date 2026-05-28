'use client';

import { useState, useTransition } from 'react';

import { updateContactDetails } from '../../actions';

interface Social {
  linkedin?: string;
  facebook?: string;
  instagram?: string;
  twitter?: string;
  github?: string;
}

interface ContactInput {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneE164: string;
  city: string | null;
  country: string | null;
  address: string | null;
  company: string | null;
  socialLinks: Record<string, string>;
}

interface Props {
  contact: ContactInput;
}

export function ContactDetailForm({ contact }: Props) {
  const [firstName, setFirstName] = useState(contact.firstName ?? '');
  const [lastName, setLastName] = useState(contact.lastName ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [city, setCity] = useState(contact.city ?? '');
  const [country, setCountry] = useState(contact.country ?? '');
  const [address, setAddress] = useState(contact.address ?? '');
  const [company, setCompany] = useState(contact.company ?? '');
  const [social, setSocial] = useState<Social>({
    linkedin: contact.socialLinks?.linkedin ?? '',
    facebook: contact.socialLinks?.facebook ?? '',
    instagram: contact.socialLinks?.instagram ?? '',
    twitter: contact.socialLinks?.twitter ?? '',
    github: contact.socialLinks?.github ?? '',
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateContactDetails({
        contactId: contact.id,
        firstName,
        lastName,
        email,
        city,
        country,
        address,
        company,
        socialLinks: social,
      });
      if (res.success) {
        setSaved(true);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900">Editar detalles del contacto</h2>
        {error && (
          <p className="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}
        {saved && !pending && (
          <p className="mt-2 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            Guardado.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldInput label="Nombre" value={firstName} onChange={setFirstName} placeholder="Nombre" />
        <FieldInput label="Apellido" value={lastName} onChange={setLastName} placeholder="Apellido" />
        <FieldInput
          label="Email"
          value={email}
          onChange={setEmail}
          placeholder="Ingrese el correo electrónico"
          type="email"
        />
        <FieldInput
          label="Teléfono"
          value={contact.phoneE164}
          onChange={() => undefined}
          placeholder=""
          readOnly
        />
        <FieldInput label="Ciudad" value={city} onChange={setCity} placeholder="Introduzca el nombre de la ciudad" />
        <FieldInput label="País" value={country} onChange={setCountry} placeholder="País" />
        <FieldInput
          label="Dirección"
          value={address}
          onChange={setAddress}
          placeholder="Dirección"
        />
        <FieldInput
          label="Empresa"
          value={company}
          onChange={setCompany}
          placeholder="Escriba el nombre de la empresa"
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900">Enlaces de redes sociales</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldInput
            label="LinkedIn"
            value={social.linkedin ?? ''}
            onChange={(v) => setSocial((s) => ({ ...s, linkedin: v }))}
            placeholder="https://linkedin.com/in/..."
          />
          <FieldInput
            label="Facebook"
            value={social.facebook ?? ''}
            onChange={(v) => setSocial((s) => ({ ...s, facebook: v }))}
            placeholder="https://facebook.com/..."
          />
          <FieldInput
            label="Instagram"
            value={social.instagram ?? ''}
            onChange={(v) => setSocial((s) => ({ ...s, instagram: v }))}
            placeholder="https://instagram.com/..."
          />
          <FieldInput
            label="Twitter / X"
            value={social.twitter ?? ''}
            onChange={(v) => setSocial((s) => ({ ...s, twitter: v }))}
            placeholder="https://x.com/..."
          />
          <FieldInput
            label="GitHub"
            value={social.github ?? ''}
            onChange={(v) => setSocial((s) => ({ ...s, github: v }))}
            placeholder="https://github.com/..."
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? 'Guardando…' : 'Actualizar contacto'}
        </button>
      </div>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase text-zinc-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none ${
          readOnly ? 'bg-zinc-50 text-zinc-500' : ''
        }`}
      />
    </label>
  );
}
