import { openUrl } from "@tauri-apps/plugin-opener";
import { motion } from "motion/react";
import { useState } from "react";
import { ipc, type GhPr } from "../../lib/ipc";
import { useIsland } from "../../store/islandStore";
import { CheckIcon, CloseIcon, ClockIcon, ExternalIcon, RefreshIcon } from "../icons";
import { Empty, IconButton, relativeTime } from "../parts";

const CI: Record<string, { label: string; color: string }> = {
  SUCCESS: { label: "CI ok", color: "#30d158" },
  FAILURE: { label: "CI falló", color: "#ff453a" },
  ERROR: { label: "CI con error", color: "#ff453a" },
  PENDING: { label: "CI corriendo", color: "#ff9f0a" },
  EXPECTED: { label: "CI esperando", color: "#ff9f0a" },
};
const REVIEW: Record<string, { label: string; color: string }> = {
  APPROVED: { label: "aprobado", color: "#30d158" },
  CHANGES_REQUESTED: { label: "piden cambios", color: "#ff9f0a" },
};

function CiIcon({ state }: { state: string }) {
  if (state === "SUCCESS") return <CheckIcon size={11} />;
  if (state === "FAILURE" || state === "ERROR") return <CloseIcon size={11} />;
  return <ClockIcon size={11} />;
}

function PrRow({ pr, index, showAuthor }: { pr: GhPr; index: number; showAuthor?: boolean }) {
  const ci = pr.ci ? CI[pr.ci] : undefined;
  const review = pr.review ? REVIEW[pr.review] : undefined;
  return (
    <motion.div
      className="list-row clip-row"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 32, delay: Math.min(index, 8) * 0.03 }}
      onClick={() => openUrl(pr.url)}
      title={`Abrir ${pr.repo}#${pr.number}`}
    >
      <div className="col grow min-w-0">
        <span className="text-sm truncate">{pr.title}</span>
        <span className="caption truncate">
          {pr.repo}#{pr.number}
          {showAuthor && pr.author ? ` · de ${pr.author}` : ""}
          {pr.draft ? " · borrador" : ""}
          {review ? <span style={{ color: review.color }}> · {review.label}</span> : null}
        </span>
      </div>
      {ci && (
        <span className="ci-pill" style={{ color: ci.color }}>
          <CiIcon state={pr.ci!} /> {ci.label}
        </span>
      )}
      <span className="caption nowrap">{relativeTime(Date.parse(pr.updatedAt))}</span>
    </motion.div>
  );
}

/** Tus PR abiertos (con su CI) y los que te pidieron revisar, con tu sesión de `gh`. */
export function GithubView() {
  const gh = useIsland((s) => s.github);
  const setGithub = useIsland((s) => s.setGithub);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setGithub(await ipc.githubRefresh());
    setLoading(false);
  };

  if (!gh) return <Empty icon={<RefreshIcon size={22} />} title="Consultando GitHub…" body="Uso tu sesión de la CLI gh; no guardo tokens." />;
  if (!gh.connected) {
    return (
      <Empty icon={<ExternalIcon size={22} />} title="GitHub no está conectado" body={gh.error ?? "Instala la CLI de GitHub (gh) y ejecuta gh auth login."}>
        <button className="link-btn" onClick={refresh}>Reintentar</button>
      </Empty>
    );
  }

  return (
    <div className="list">
      <div className="row gap-6 gh-head">
        <span className="caption">@{gh.login} · actualizado {relativeTime(gh.updatedMs)}</span>
        <span className="grow" />
        <IconButton onClick={refresh} title="Actualizar ahora" size={24}>
          <motion.span animate={{ rotate: loading ? 360 : 0 }} transition={loading ? { repeat: Infinity, duration: 0.8, ease: "linear" } : {}}>
            <RefreshIcon size={12} />
          </motion.span>
        </IconButton>
      </div>
      <span className="section-title gh-section">Te piden revisar {gh.reviews.length > 0 && `(${gh.reviews.length})`}</span>
      {gh.reviews.length ? gh.reviews.map((p, i) => <PrRow key={p.url} pr={p} index={i} showAuthor />) : <span className="caption gh-empty">Nada pendiente.</span>}
      <span className="section-title gh-section">Tus PR abiertos {gh.mine.length > 0 && `(${gh.mine.length})`}</span>
      {gh.mine.length ? gh.mine.map((p, i) => <PrRow key={p.url} pr={p} index={i} />) : <span className="caption gh-empty">No tienes PR abiertos.</span>}
    </div>
  );
}
