// Shim para que `import 'server-only'` sea no-op en el worker.
// Next.js usa este paquete para impedir imports desde client components,
// pero el worker no es ni server component ni client component — es un
// proceso Node standalone que necesita acceder a los mismos módulos.
import { Module } from 'node:module';

const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  parent: any,
  isMain: boolean,
  options: any,
) {
  if (request === 'server-only') {
    return require.resolve('./server-only-shim.cjs');
  }
  return origResolve.call(this, request, parent, isMain, options);
};
