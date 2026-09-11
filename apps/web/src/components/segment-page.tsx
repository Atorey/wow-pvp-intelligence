import { MIN_SAMPLE_HIGH, MIN_SAMPLE_MEDIUM, formatSegment, type SpecRoute } from "@wowpvp/core";
import type { ReactNode } from "react";

import { classColor } from "../design/class-color";
import { copyFor } from "../i18n/copy";
import { formatCount, formatRating } from "../i18n/format";
import type { Locale } from "../i18n/locales";
import type { SegmentPageData } from "../server/spec";
import type { SegmentDetail } from "../server/spec-view";
import { AdoptionList } from "./adoption-list";
import { DeclaredAbsence } from "./counted-figure";
import { FigureCard } from "./figure-card";
import { RunProvenance } from "./run-provenance";
import { SectionCard } from "./section-card";
import { SegmentNav } from "./segment-nav";
import { SmallSampleNotice } from "./small-sample-notice";
import { EmptyNotice, MethodologyLink, SpecHeader } from "./spec-page";
import { Card } from "./ui/card";
import { Separator } from "./ui/separator";

/**
 * Cuántas filas se ven sin desplegar. Son las del mockup: tres por hueco y cinco
 * en los grupos de dos, que tienen el doble de piezas. El resto se pliega, no se
 * corta (`AdoptionList`).
 */
const VISIBLE = { slot: 3, pairedSlot: 5, family: 10 } as const;

/**
 * La página de un tramo: qué se lleva en él, hueco por hueco, y qué talentos.
 *
 * Gear y talentos van en la misma página y no en pestañas, aunque el perfil sí
 * las use. La canónica no lleva query (ADR 0029, decisión 7) y un tramo que se
 * indexa por sus nodos tiene que enseñarlos en la dirección que se indexa, no
 * detrás de un `?tab=`.
 */
export function SegmentPage({
  route,
  locale,
  data,
}: {
  route: SpecRoute;
  locale: Locale;
  data: SegmentPageData;
}) {
  const copy = copyFor(locale).spec;
  const { bracket, segment } = route;
  // La ruta de tramo siempre trae los dos; el tipo de la ruta no lo sabe.
  if (!bracket || !segment) return null;

  const { scope, detail, computedAt } = data;
  const label = formatSegment(segment);
  const fill = classColor(route.spec.classSlug).fill;

  return (
    <main className="mx-auto flex max-w-page flex-col gap-8 px-5 py-8 lg:px-8">
      <SpecHeader route={route} locale={locale} scope={scope} showBrackets={false} />
      {detail === null ? (
        <>
          <EmptyNotice text={copy.empty.segment(route.spec.label, label)} />
          <RunProvenance locale={locale} computedAt={computedAt} />
        </>
      ) : (
        <>
          <SegmentFigures locale={locale} detail={detail} />
          <GearSection locale={locale} detail={detail} segment={label} fill={fill} />
          <TalentsSection locale={locale} detail={detail} fill={fill} />
          <NotPublished locale={locale} />
          <p className="text-muted-foreground max-w-measure text-sm">{copy.segment.causality}</p>
          <RunProvenance locale={locale} computedAt={computedAt} />
        </>
      )}
      <SegmentNav spec={route.spec} bracket={bracket} segment={segment} locale={locale} />
      <MethodologyLink locale={locale} />
    </main>
  );
}

/**
 * Las cifras de cabecera del tramo. Población y perfiles con gear van juntas y
 * con su nombre, porque la segunda es la base de todo lo de abajo y la primera
 * no lo es de nada.
 */
function SegmentFigures({ locale, detail }: { locale: Locale; detail: SegmentDetail }) {
  const copy = copyFor(locale).spec;
  const figures = copy.segment.figures;
  const { population, gear, activityWindowDays } = detail.segment;
  const count = (value: number): string => formatCount(value, locale);
  const confidenceNote =
    gear.confidence === "high"
      ? figures.confidenceHigh(count(MIN_SAMPLE_HIGH))
      : gear.confidence === "medium"
        ? figures.confidenceMedium(count(MIN_SAMPLE_MEDIUM), count(MIN_SAMPLE_HIGH - 1))
        : figures.confidenceNone(count(MIN_SAMPLE_MEDIUM));

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <FigureCard
        value={count(population.sampleSize)}
        label={figures.observed}
        note={figures.window(count(activityWindowDays))}
      />
      <FigureCard value={count(gear.denominator)} label={figures.gear} note={figures.gearNote} />
      <FigureCard
        value={copy.confidence[gear.confidence]}
        label={figures.confidence}
        note={confidenceNote}
      />
      {detail.itemLevel && (
        <FigureCard
          value={formatRating(detail.itemLevel.median, locale)}
          label={figures.itemLevel}
          note={figures.itemLevelNote(count(detail.itemLevel.sample))}
        />
      )}
    </div>
  );
}

function GearSection({
  locale,
  detail,
  segment,
  fill,
}: {
  locale: Locale;
  detail: SegmentDetail;
  segment: string;
  fill: string;
}) {
  const copy = copyFor(locale).spec.segment;
  const { gear } = detail;
  const population = detail.segment.population.sampleSize;
  const count = (value: number): string => formatCount(value, locale);

  if (gear.state === "insufficient") {
    return (
      <SectionCard title={copy.gear.title}>
        {/*
         * El contenido se sustituye por la causa, con sus dos cifras: ni lista
         * recortada ni porcentajes en gris (§1.5 del brief).
         */}
        <p className="text-muted-foreground max-w-measure text-base">
          {gear.cause === "sampling"
            ? copy.gear.bySampling(
                count(gear.sample),
                count(population),
                segment,
                count(gear.needed),
              )
            : copy.gear.byPopulation(count(population), segment, count(gear.needed))}
        </p>
      </SectionCard>
    );
  }

  const { slots, gems, enchants } = gear.content;
  const slotLabels: Record<string, string> = copyFor(locale).player.gear.slots;
  const groupLabels: Record<string, string> = copy.gear.groups;

  return (
    <SectionCard title={copy.gear.title}>
      {gear.confidence === "medium" && (
        <SmallSampleNotice
          text={copy.smallSample(count(MIN_SAMPLE_MEDIUM), count(MIN_SAMPLE_HIGH - 1))}
        />
      )}
      <p className="text-muted-foreground max-w-measure text-sm">
        {copy.gear.note(count(gear.sample), count(population))}
      </p>
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
        {slots.map((slot) => (
          <FamilyBlock
            key={slot.group}
            title={groupLabels[slot.group] ?? slotLabels[slot.group] ?? slot.group}
            aside={slot.paired ? copy.gear.paired : undefined}
          >
            <AdoptionList
              locale={locale}
              rows={slot.rows}
              visible={slot.paired ? VISIBLE.pairedSlot : VISIBLE.slot}
              fill={fill}
              withIcon
            />
          </FamilyBlock>
        ))}
      </div>
      {slots.some((slot) => slot.paired) && (
        <p className="text-muted-foreground max-w-measure text-sm">{copy.gear.pairedNote}</p>
      )}
      {(gems.length > 0 || enchants.length > 0) && (
        <>
          <Separator />
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
            {gems.length > 0 && (
              <FamilyBlock title={copy.gear.gems}>
                <AdoptionList
                  locale={locale}
                  rows={gems}
                  visible={VISIBLE.family}
                  fill={fill}
                  withIcon
                />
              </FamilyBlock>
            )}
            {enchants.length > 0 && (
              <FamilyBlock title={copy.gear.enchants}>
                <AdoptionList
                  locale={locale}
                  rows={enchants}
                  visible={VISIBLE.family}
                  fill={fill}
                  withIcon
                />
              </FamilyBlock>
            )}
          </div>
        </>
      )}
      {gear.unavailable > 0 && (
        <p className="text-muted-foreground max-w-measure text-sm">
          {copy.unavailable(count(gear.unavailable))}
        </p>
      )}
    </SectionCard>
  );
}

/**
 * Los talentos del tramo, en dos bloques porque son dos bases: los nodos y el
 * árbol de héroe salen del loadout, y los talentos PvP de otra parte del perfil
 * que la API omite más a menudo (ADR 0026). Cada bloque se decide y se declara
 * con la suya.
 */
function TalentsSection({
  locale,
  detail,
  fill,
}: {
  locale: Locale;
  detail: SegmentDetail;
  fill: string;
}) {
  const copy = copyFor(locale).spec.segment;
  const talents = copy.talents;
  const { build, pvp } = detail;
  const count = (value: number): string => formatCount(value, locale);
  const smallSample = copy.smallSample(count(MIN_SAMPLE_MEDIUM), count(MIN_SAMPLE_HIGH - 1));

  return (
    <SectionCard title={talents.title}>
      {build.state === "insufficient" ? (
        <DeclaredAbsence
          label={talents.nodesLabel}
          body={talents.none(count(build.sample), count(build.needed))}
        />
      ) : (
        <>
          {build.confidence === "medium" && <SmallSampleNotice text={smallSample} />}
          <p className="text-muted-foreground max-w-measure text-sm">
            {talents.note(count(build.sample))}
          </p>
          {build.content.heroTrees.length > 0 && (
            <FamilyBlock title={talents.heroTrees}>
              <AdoptionList
                locale={locale}
                rows={build.content.heroTrees}
                visible={VISIBLE.family}
                fill={fill}
                withIcon={false}
              />
            </FamilyBlock>
          )}
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
            {build.content.trees.map((view) => (
              <FamilyBlock key={view.tree} title={talents.trees[view.tree]}>
                <AdoptionList
                  locale={locale}
                  rows={view.rows}
                  visible={VISIBLE.family}
                  fill={fill}
                  withIcon={false}
                />
              </FamilyBlock>
            ))}
          </div>
          {build.unavailable > 0 && (
            <p className="text-muted-foreground max-w-measure text-sm">
              {copy.unavailable(count(build.unavailable))}
            </p>
          )}
        </>
      )}
      <Separator />
      {pvp.state === "insufficient" ? (
        <DeclaredAbsence
          label={talents.pvp}
          body={talents.none(count(pvp.sample), count(pvp.needed))}
        />
      ) : (
        <>
          {pvp.confidence === "medium" && <SmallSampleNotice text={smallSample} />}
          <FamilyBlock title={talents.pvp}>
            <p className="text-muted-foreground max-w-measure pb-1 text-sm">
              {talents.pvpNote(count(pvp.sample))}
            </p>
            <AdoptionList
              locale={locale}
              rows={pvp.content}
              visible={VISIBLE.family}
              fill={fill}
              withIcon={false}
            />
          </FamilyBlock>
          {pvp.unavailable > 0 && (
            <p className="text-muted-foreground max-w-measure text-sm">
              {copy.unavailable(count(pvp.unavailable))}
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}

/**
 * Lo que no se publica, nombrado: omitirlo en silencio lo daría por medido.
 *
 * `Card` con el borde discontinuo, que es como se pinta el texto estático que
 * declara una ausencia (§5.0 del sistema).
 */
function NotPublished({ locale }: { locale: Locale }) {
  const copy = copyFor(locale).spec.segment.notPublished;

  return (
    <Card className="gap-3 border-dashed p-5 shadow-none">
      <h2 className="text-subtle-foreground tracking-caps text-xs uppercase">{copy.title}</h2>
      <DeclaredAbsence label={copy.stats.label} body={copy.stats.body} />
    </Card>
  );
}

/** Un grupo de filas con su título en versalita, como los de la caja Player Gap. */
function FamilyBlock({
  title,
  aside,
  children,
}: {
  title: string;
  /** Una precisión que va con el título y no es parte de él: "los dos huecos juntos". */
  aside?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="text-subtle-foreground tracking-caps text-xs uppercase">
        {title}
        {aside !== undefined && <span className="tracking-normal normal-case"> · {aside}</span>}
      </h3>
      {children}
    </div>
  );
}
