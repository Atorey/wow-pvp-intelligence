import { MIN_DISCRIMINATIVE_DELTA, formatSegment } from "@wowpvp/core";

import { copyFor } from "../i18n/copy";
import { formatCount, formatPercent, formatRating } from "../i18n/format";
import type { Locale } from "../i18n/locales";
import type { GapView, ListView } from "../server/player-profile";
import { DeclaredAbsence } from "./counted-figure";
import { DifferenceRow } from "./difference-row";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Separator } from "./ui/separator";

/**
 * La caja Player Gap (§1 del brief).
 *
 * **Los estados no son variantes de estilo, son composiciones distintas**
 * (§5.2 del sistema visual). Por eso aquí no hay una caja con una prop
 * `confidence` que cambie un borde: hay un `switch` sobre el estado y cada rama
 * escribe lo suyo. Quien decide es `canShowComparison()` en
 * `player-profile.ts`; este componente obedece y no vuelve a mirar ningún
 * umbral.
 *
 * Lo que la caja **no** hace, y no es descuido: ni barras, ni medidores, ni
 * listas recortadas, ni cifras de relleno en gris (§1.8). Cuando no hay
 * comparación, el contenido se sustituye por la explicación y la caja mantiene
 * su sitio y su tamaño: desaparecer no explica nada.
 */
export function PlayerGapBox({
  locale,
  gap,
  subject,
}: {
  locale: Locale;
  gap: GapView;
  /** Quién es el sujeto de la comparación, declarado una vez y siempre visible. */
  subject: { spec: string; bracket: string; rating: number };
}) {
  const copy = copyFor(locale).player.gap;
  const line = copy.subject(subject.spec, subject.bracket, formatRating(subject.rating, locale));

  if (gap.state === "top-segment") {
    return (
      <Card className="gap-4 p-5">
        <Heading title={copy.topSegment.title} subject={line} />
        <p className="text-muted-foreground text-base">{copy.topSegment.body}</p>
      </Card>
    );
  }

  const target = formatSegment(gap.targetSegment);
  const segments = copy.segments(formatSegment(gap.ownSegment), target);
  /*
   * El titular nombra el suelo del objetivo y no el tramo entero: la pregunta
   * del jugador es "¿qué me separa de 2000?", y "2000-2200" convierte el
   * escalón en un intervalo del que hay que salir por arriba también. El tramo
   * completo sigue escrito debajo, en la línea de los dos segmentos.
   */
  const threshold = `${formatRating(gap.targetSegment.min, locale)}+`;

  if (gap.state === "insufficient") {
    return (
      <Card className="border-t-warning-border gap-4 border-t-2 p-5">
        <Heading title={copy.title(threshold)} subject={line} segments={segments} />
        <ConfidenceBadge label={copy.confidence.insufficient} tone="warning" />
        <Separator />
        {/*
         * El contenido sustituido: un titular corto y la causa, con sus dos
         * cifras crudas. Las dos causas se dicen distinto a propósito — llamar
         * "no hay gente" a "no tenemos su equipo" le echaría al juego la culpa
         * de nuestro muestreo (§1.5).
         */}
        <p className="text-foreground font-display text-lg">{copy.none.title}</p>
        <p className="text-muted-foreground max-w-measure text-base">
          {gap.cause === "subject"
            ? copy.none.bySubject
            : gap.cause === "population"
              ? // El cero no se cuenta, se dice: "solo 0 han llegado" no es una
                // frase, y al empezar la temporada es el caso mayoritario arriba.
                gap.population === 0
                ? copy.none.noneObserved(subject.spec, target, formatCount(gap.needed, locale))
                : copy.none.byPopulation(
                    formatCount(gap.population, locale),
                    subject.spec,
                    target,
                    formatCount(gap.needed, locale),
                  )
              : copy.none.bySampling(
                  formatCount(gap.population, locale),
                  formatCount(gap.gearSample, locale),
                  target,
                  formatCount(gap.needed, locale),
                )}
        </p>
      </Card>
    );
  }

  return (
    <Card
      className={`gap-4 p-5 ${gap.confidence === "medium" ? "border-t-warning-border border-t-2" : ""}`}
    >
      <Heading title={copy.title(threshold)} subject={line} segments={segments} />
      <div className="flex flex-wrap items-center gap-3">
        {/* La muestra va dentro de la caja y siempre visible, nunca en un tooltip (§13.5). */}
        <span className="text-subtle-foreground text-sm">
          {copy.sampled(formatCount(gap.gearSample, locale), target)}
        </span>
        <ConfidenceBadge
          label={copy.confidence[gap.confidence]}
          tone={gap.confidence === "medium" ? "warning" : "neutral"}
        />
      </div>
      {gap.confidence === "medium" && <SmallSampleNotice text={copy.smallSample} />}
      <Separator />
      {/*
       * Las dos cifras de contexto de §1.3, cada una con su lectura literal al
       * lado. Son cifras, no barras: la de solapamiento sube cuando llevas lo
       * que lleva mucha gente, así que dibujada como medidor se leería como un
       * marcador de progreso hacia el rating, que es justo lo que no es (§1.4).
       */}
      {gap.itemLevel && (
        <Figure
          label={copy.itemLevel.label}
          reading={copy.itemLevel.reading(
            formatRating(gap.itemLevel.player, locale),
            target,
            formatRating(gap.itemLevel.median, locale),
          )}
        />
      )}
      {gap.overlap !== null && gap.overlap.score !== null && (
        <Figure
          label={copy.overlap.label}
          reading={copy.overlap.reading(
            formatPercent(gap.overlap.score, locale),
            target,
            formatCount(gap.overlap.comparedItems, locale),
          )}
        />
      )}
      <Separator />
      <DifferenceList
        locale={locale}
        list={gap.gear}
        title={copy.list.gear(target)}
        label={copy.absence.gear}
        target={target}
        own={formatSegment(gap.ownSegment)}
        // La lista de gear se calcula sobre la misma base que la cabecera, así
        // que solo declara la suya si alguna vez difieren: escribir dos veces el
        // mismo número a tres líneas de distancia se lee como dos cifras.
        declaresSample={gap.gear.state !== "listed" || gap.gear.sample !== gap.gearSample}
      />
      <DifferenceList
        locale={locale}
        list={gap.talents}
        title={copy.list.talents(target)}
        label={copy.absence.talents}
        target={target}
        own={formatSegment(gap.ownSegment)}
        // La de nodos siempre declara la suya: su denominador es otro, y hoy
        // suele ser mucho menor (ADR 0026).
        declaresSample
      />
      {/* Lo que no se compara se nombra; omitirlo en silencio lo daría por comparado. */}
      <p className="text-muted-foreground text-sm">{copy.notCompared}</p>
      <p className="text-muted-foreground max-w-measure text-sm">{copy.causality}</p>
    </Card>
  );
}

/** Una cifra de contexto: qué se mide arriba y su lectura literal debajo. */
function Figure({ label, reading }: { label: string; reading: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-subtle-foreground text-sm">{label}</p>
      <p className="text-foreground text-lg">{reading}</p>
    </div>
  );
}

/**
 * Una de las dos listas de diferencias, con sus dos salidas.
 *
 * **Una lista vacía y una lista sin base no se dicen igual.** La primera es un
 * resultado —ninguna variable supera el umbral discriminante, §13.5— y la
 * segunda es una ausencia de dato con su denominador delante. Fundirlas en un
 * "no hay datos" convertiría un hallazgo en un fallo.
 */
function DifferenceList({
  locale,
  list,
  title,
  label,
  target,
  own,
  declaresSample,
}: {
  locale: Locale;
  list: ListView;
  title: string;
  /** Cómo se nombra esta familia cuando lo que hay que escribir es su ausencia. */
  label: string;
  target: string;
  own: string;
  /** Si esta lista declara su propia muestra además de la de la cabecera. */
  declaresSample: boolean;
}) {
  const copy = copyFor(locale).player.gap;

  if (list.state === "insufficient") {
    return (
      <DeclaredAbsence
        label={label}
        body={
          list.missing === "target"
            ? copy.absence.target(
                formatCount(list.sample, locale),
                target,
                formatCount(list.needed, locale),
              )
            : copy.absence.own(
                formatCount(list.sample, locale),
                own,
                formatCount(list.needed, locale),
              )
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-subtle-foreground tracking-caps text-xs uppercase">{title}</h3>
      {declaresSample && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-subtle-foreground text-sm">
            {copy.sampled(formatCount(list.sample, locale), target)}
          </span>
          <ConfidenceBadge
            label={copy.confidence[list.confidence]}
            tone={list.confidence === "medium" ? "warning" : "neutral"}
          />
        </div>
      )}
      {list.differences.length === 0 ? (
        <p className="text-muted-foreground max-w-measure text-sm">
          {copy.list.empty(formatPercent(MIN_DISCRIMINATIVE_DELTA, locale))}
        </p>
      ) : (
        <ol className="flex flex-col">
          {list.differences.map((difference, index) => (
            <DifferenceRow
              key={difference.variable.key}
              locale={locale}
              position={index + 1}
              difference={difference}
            />
          ))}
        </ol>
      )}
      {list.unavailable > 0 && (
        // La exclusión por dato no disponible se declara: contarlos como
        // no-adopción falsearía el porcentaje, y callarlos lo daría por completo.
        <p className="text-muted-foreground max-w-measure text-sm">
          {copy.list.unavailable(formatCount(list.unavailable, locale), target)}
        </p>
      )}
    </div>
  );
}

function Heading({
  title,
  subject,
  segments,
}: {
  title: string;
  subject: string;
  segments?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-foreground text-xl">{title}</h2>
      <p className="text-subtle-foreground text-sm">{subject}</p>
      {segments !== undefined && <p className="text-muted-foreground text-sm">{segments}</p>}
    </div>
  );
}

/**
 * El aviso de muestra reducida del estado `medium`.
 *
 * **Ocupa espacio y desplaza al resto**, que es su función entera: si se pudiera
 * pasar por alto haciendo scroll rápido no cumpliría el "aviso visible" de la
 * §13.4. No es un borde de color ni un icono, y lo que comunica lo comunica el
 * texto — sin distinguir colores se recibe la misma información.
 *
 * Es un `Alert` y no una `Card` con borde discontinuo, que es la distinción que
 * hace la §5.0 del sistema: `role="alert"` es una región viva y esto sí es algo
 * que cambia con el dato —la comparación se está enseñando **con reservas**—, a
 * diferencia de "esta lectura todavía no está publicada", que estaba igual antes
 * de entrar en la página.
 */
function SmallSampleNotice({ text }: { text: string }) {
  return (
    <Alert className="bg-warning border-warning-border text-warning-foreground">
      <AlertDescription className="text-warning-foreground">{text}</AlertDescription>
    </Alert>
  );
}

/**
 * La confianza declarada, en la única forma en la que el color no informa por su
 * cuenta: la palabra está escrita dentro (§1.7 del brief).
 */
function ConfidenceBadge({ label, tone }: { label: string; tone: "warning" | "neutral" }) {
  return (
    <Badge
      variant="outline"
      className={
        tone === "warning" ? "bg-warning border-warning-border text-warning-foreground" : ""
      }
    >
      {label}
    </Badge>
  );
}
