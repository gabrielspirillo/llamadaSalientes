-- La plantilla del consentimiento informado de Respinens (menores de edad).
--
-- Es el texto que redactó la clínica, en bloques. Los datos del menor y del
-- tutor NO van aquí: los imprime la app ya rellenos en cada envío. Idempotente
-- por (clínica, clave); si la clínica edita el texto después, no se pisa.
-- Misma búsqueda de la clínica que en 0031 (slug, con caída al nombre).

WITH por_slug AS (
  SELECT id FROM tenants WHERE slug = 'respinens-logo-1789808641416119420'
),
por_nombre AS (
  SELECT id FROM tenants WHERE lower(name) LIKE 'respinens%'
),
objetivo AS (
  SELECT id FROM por_slug
  UNION ALL
  SELECT id FROM por_nombre
  WHERE NOT EXISTS (SELECT 1 FROM por_slug)
    AND (SELECT count(*) FROM por_nombre) = 1
)
INSERT INTO consent_templates (tenant_id, key, title, body, acknowledgments, message_template)
SELECT
  id,
  'CONSENTIMIENTO_MENOR',
  'Consentimiento informado para menores de edad',
  $body$[
    {"type": "paragraph", "text": "La fisioterapia respiratoria es una especialidad de la fisioterapia que, basándose en el profundo conocimiento del sistema respiratorio y las alteraciones fisiopatológicas que cursan las patologías respiratorias, desarrolla un conjunto de procedimientos que, a través de la aplicación de medios físicos (nebulización de suero hipertónico, vibración mecánica, lavados nasales con suero fisiológico y maniobras de fisioterapia no invasivas) tiene como objetivo la prevención, curación y estabilización de alteraciones que afectan al sistema respiratorio."},
    {"type": "paragraph", "text": "La metodología aplicada en RESPINENS y realizada por Raquel Pinto Egea (nº col 10.751) consta de procedimientos certificados y cualificados dentro del campo de la fisioterapia respiratoria."},
    {"type": "paragraph", "text": "Como centro sanitario autorizado por la Consejería de la Comunidad de Madrid (CS 17835), informamos al padre, madre y/o tutor legal antes de realizar cualquier tratamiento al menor (paciente) en qué consiste y qué se va a realizar en la sesión, además de los posibles efectos secundarios que pueden aparecer:"},
    {"type": "bullets", "items": [
      "Frecuentes: vómitos y deposiciones con moco",
      "Poco frecuentes: mordedura/hematoma leve de la lengua, incremento de la tos",
      "Raras: fiebre, petequias",
      "Muy raras: derrame ocular, espasmo laríngeo, aumento de la presión abdominal, inguinal e intracraneal"
    ]},
    {"type": "paragraph", "text": "Yo, padre, madre y/o tutor legal (abajo indicado) del/la menor (abajo indicado) manifiesto que: He recibido de RESPINENS toda la información necesaria de forma confidencial, clara, comprensible y satisfactoria sobre la naturaleza y propósito de los objetivos y procedimientos que se seguirán a lo largo del proceso que se deriva de la demanda formulada, y que este proceso está sujeto al secreto profesional y al resto de los preceptos que rigen en el Código Deontológico y en las diferentes normas de deontología profesional."},
    {"type": "paragraph", "text": "Así mismo se me ha informado de que:"},
    {"type": "bullets", "items": [
      "No se iniciará ninguna intervención con el/la menor hasta haber solicitado y obtenido consentimiento informado expreso y por escrito del otro progenitor/tutor-a legal (salvo que legalmente no sea necesario).",
      "Se me informará de los aspectos relacionados con la intervención y con su evolución, manteniendo como confidenciales los datos que así hayamos acordado previamente entre progenitores/tutores, el/la menor y el/la profesional.",
      "Como profesional, tiene la obligación legal de revelar ante las instancias oportunas información confidencial en aquellas situaciones que pudieran representar un riesgo grave para el/la menor u otras personas, si tuviera conocimiento de la comisión actual o futura de un delito contra el/la menor u otras personas, o bien porque así fuera ordenado judicialmente; en este último caso, se proporcionará sólo aquella información que sea relevante para el asunto en cuestión manteniendo la confidencialidad de cualquier otra información."
    ]},
    {"type": "paragraph", "text": "Por tanto, yo padre, madre y/o tutor legal (abajo indicado) AUTORIZO y OTORGO MI EXPRESO CONSENTIMIENTO a RESPINENS a realizar la citada intervención profesional con el/la menor (abajo indicado) y a todo lo indicado anteriormente."},
    {"type": "heading", "text": "Protección de datos"},
    {"type": "paragraph", "text": "De conformidad con el Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo (RGPD) y la Ley Orgánica 3/2018 de Protección de Datos Personales y garantía de los derechos digitales (LOPDGDD), se informa al paciente de lo siguiente:"},
    {"type": "numbered", "items": [
      {"title": "Responsable del tratamiento", "text": "RESPINENS, Av. Carmen Martín Gaite 17, 28919, Leganés (Madrid). 676790181. respinens@gmail.com"},
      {"title": "Finalidad del tratamiento", "text": "Los datos personales que se recogen serán utilizados para las siguientes finalidades: gestionar su historia clínica y el tratamiento fisioterapéutico solicitado; realizar el seguimiento clínico y la facturación de los servicios prestados; enviar recordatorios o comunicaciones relacionadas con citas, revisiones o tratamientos por los medios que usted autorice (teléfono, correo electrónico, SMS, WhatsApp, etc.); cumplir con las obligaciones legales y de facturación derivadas de la prestación sanitaria."},
      {"title": "Legitimación del tratamiento", "text": "El tratamiento de sus datos se basa en: la ejecución del contrato de prestación de servicios sanitarios entre el paciente y la clínica; el consentimiento explícito del interesado para el tratamiento de datos de salud (art. 9.2.a RGPD); el cumplimiento de obligaciones legales en materia sanitaria y fiscal."},
      {"title": "Conservación de los datos", "text": "Los datos personales se conservarán mientras exista una relación asistencial y durante los plazos exigidos por la legislación sanitaria y fiscal (habitualmente 5 años tras la última atención médica, salvo que la normativa establezca otro periodo)."},
      {"title": "Destinatarios y encargados de los datos", "text": "Sus datos podrán ser comunicados a: entidades aseguradoras o mutuas, cuando la asistencia sea gestionada a través de ellas; autoridades sanitarias o judiciales, cuando exista obligación legal de hacerlo; asesores fiscales o contables, únicamente en relación con obligaciones legales de facturación. En particular, para la gestión de pacientes, citas, historias clínicas y documentación se utiliza la plataforma Futura, proporcionada por Futura Digital Solutions S.L., que tratará los datos siguiendo las instrucciones del responsable y en virtud del correspondiente contrato de encargo del tratamiento. En ningún caso se cederán datos a terceros con fines comerciales."},
      {"title": "Derechos del paciente", "text": "Usted puede ejercer los derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad de sus datos, dirigiéndose por escrito al centro. Asimismo podrá presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD) si considera que sus derechos no han sido respetados."}
    ]},
    {"type": "paragraph", "text": "NOTA: En las facturas emitidas aparecerán los datos fiscales del padre, madre y/o tutor legal (excepto que se indiquen otros PREVIAMENTE INFORMADOS a la emisión de esta). En el concepto de la factura aparecerán el nombre y los apellidos del paciente."},
    {"type": "paragraph", "text": "Yo, padre, madre y/o tutor legal (abajo indicado), declaro que he leído y comprendido toda la información contenida en este documento y que consiento de forma libre y voluntaria lo que en él se describe."}
  ]$body$::jsonb,
  $ack$[
    "He recibido toda la información necesaria de forma confidencial, clara, comprensible y satisfactoria sobre la intervención con el/la menor.",
    "Comprendo que no se iniciará ninguna intervención con el/la menor sin el consentimiento del otro progenitor/tutor-a legal (salvo que legalmente no sea necesario).",
    "Autorizo y otorgo mi expreso consentimiento a RESPINENS para realizar la intervención con el/la menor.",
    "Autorizo a RESPINENS al tratamiento de los datos personales indicados y de salud con las finalidades descritas.",
    "Autorizo a que se me envíen recordatorios o comunicaciones relacionadas con mi tratamiento y citas por teléfono, WhatsApp, SMS y correo electrónico.",
    "Entiendo que el presente consentimiento podrá ser revocado libremente y por escrito en cualquier momento."
  ]$ack$::jsonb,
  NULL
FROM objetivo
ON CONFLICT (tenant_id, key) DO NOTHING;
