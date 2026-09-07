-- Marca por clínica (white-label).
--
-- Hasta aquí el nombre de la clínica sólo se podía cambiar en Clerk y el logo
-- del panel era la marca "FUTURA" escrita a mano en el sidebar y en el topbar.
-- Con esto Futura (super-admin) puede darle a cada clínica su propio nombre y
-- su propio logo, y esa clínica los ve en todo el panel.
--
-- Se guardan dos cosas del logo:
--   - logo_url:  la URL pública que se pinta en el <img>.
--   - logo_path: la key dentro del bucket. Sin ella no se puede borrar el
--                objeto anterior al reemplazarlo y el bucket se llena de
--                logos huérfanos que nadie sabe a quién pertenecen.
-- Ambas nulas = la clínica no tiene logo propio y cae a la marca FUTURA.

alter table tenants add column if not exists logo_url text;
alter table tenants add column if not exists logo_path text;
