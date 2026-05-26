# La Cuenta

Una calculadora con alma de ticket para repartir gastos entre amigos sin discutir.

Pensada para el caso real: salisteis a cenar, un par de personas pagaron cosas distintas,
y hay que dividirlo entre todos los que estuvieron — algunos sólo para ciertos gastos.

**Demo →** https://marcegl.github.io/division/

## Qué cubre

| # | Caso | Cómo se modela |
|---|------|----------------|
| 01 | Pagó uno, comieron todos | un gasto con un pagador y todos los comensales marcados |
| 02 | Varios pagadores | cada gasto guarda su propio pagador; los saldos se netean |
| 03 | Participación parcial | sólo los que consumieron se marcan en *para* |
| 04 | Invita la casa | el pagador no tiene que aparecer entre los participantes |
| 05 | Mínimas transferencias | algoritmo greedy: deudor mayor ↔ acreedor mayor |
| 06 | Centavos justos | cálculo en céntimos enteros y reparto determinista del resto |

## Cómo funciona

Todo vive en el navegador. Tres bloques:

1. **Comensales** — añade y quita personas con un nombre y un color.
2. **El Ticket** — cada gasto tiene concepto, monto, **un** pagador y la lista de quién participa.
3. **Cuentas claras** — saldos por persona y la lista mínima de pagos para saldar.

Los datos se guardan en `localStorage`. El botón **compartir** copia un enlace con el
estado serializado en el hash, así que se puede pasar a alguien por chat sin servidor de por medio.

## Stack

- HTML + CSS + JS vanilla. Sin build, sin dependencias.
- Tipografía: [Fraunces](https://fonts.google.com/specimen/Fraunces) + [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) + [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono).
- Hosting: GitHub Pages.

## Desarrollo local

```bash
git clone https://github.com/marcegl/division.git
cd division
python3 -m http.server 8000     # o cualquier servidor estático
open http://localhost:8000
```

## Licencia

MIT.
