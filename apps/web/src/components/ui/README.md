# Código vendido

Lo de esta carpeta lo genera `npx shadcn@latest add <componente>` y **no lo hemos
escrito nosotros** ([ADR 0025](../../../../../docs/decisions/0025-componentes-con-shadcn-ui.md),
decisión 8). Vive en el repo en vez de en `node_modules` porque así lo distribuye
shadcn: son ficheros nuestros para leer y borrar, no una dependencia con API.

Las reglas aquí dentro son distintas al resto del proyecto:

- **Exento de la convención de comentarios.** Los comentarios en español y el
  "por qué" en vez del "qué" aplican a lo que escribimos. Esto no lo escribimos.
- **No se edita a mano salvo para tres cosas.** Las dos primeras las exige el
  [ADR 0019](../../../../../docs/decisions/0019-sistema-visual-en-css-con-tailwind.md)
  y la tercera el [ADR 0001](../../../../../docs/decisions/0001-estructura-del-repo-y-stack.md):
  - **tokenizar** lo que venga con un color literal — el `text-white` del botón
    destructivo y el `bg-black/50` de los velos ya están sustituidos por sus
    tokens;
  - **quitar los `dark:`**, que aquí siguen siendo un defecto igual que en
    cualquier otro componente: el tema se cambia reasignando variables en
    `globals.css`, no duplicando la decisión de color en el marcado;
  - **lo mínimo para que compile con nuestros flags.** shadcn no escribe contra
    `exactOptionalPropertyTypes`, así que algún componente reenvía una prop
    opcional de una forma que aquí no pasa el `typecheck`. El arreglo es dejar
    que la prop viaje en el `...props` en vez de desestructurarla y volver a
    pasarla: mismo comportamiento, sin `any` y sin `@ts-expect-error`. En
    `dropdown-menu.tsx` es lo que se ha hecho con `checked`.
- **Todo lo demás se envuelve.** Si un componente necesita comportamiento
  propio, se escribe un componente nuestro que lo use — no se le añade la lógica
  aquí dentro.
- **Prettier sí pasa por aquí.** Un formateador distinto por carpeta cuesta más
  que el diff que aparece al regenerar un componente.

Regenerar uno (`shadcn add <componente> --overwrite`) revierte las dos
sustituciones de arriba. Después de hacerlo, `grep -rn "dark:" *.tsx` sobre esta
carpeta tiene que seguir devolviendo cero.
