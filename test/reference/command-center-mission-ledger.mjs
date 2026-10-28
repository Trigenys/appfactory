// REFERENCE-ONLY, NOT SHIPPED IN CLOUDFLARE WORKER.
// Source of truth: EagleFox31/project-registry/src/mission-ledger.mjs
// Copied from Git blob 3dfececdcf2a84056356980495d76b975cfe6e91 on 2026-10-28 to enforce RAIDER parity
// in AppFactory's separate, intentionally restricted OIDC adapter.
// Do not edit the reference copy to accommodate broker behavior.
/**
 * Command Center's executor-agnostic, OFFLINE mission contract.
 *
 * No Work API, GitHub token, scheduled run or notification is invoked here.
 * A future storage adapter MUST persist the full ledger with CAS on revision;
 * invoking this pure function without transactional persistence cannot grant a lease.
 */
import { createHash } from "node:crypto";

const MANAGERS = new Set(["owner","admin"]);
const RUNNING = new Set(["running"]);
const KINDS = new Set(["manual-work","github-executor"]);
const STAGES = new Set(["before","after"]);
const STATES = new Set(["planned","running","interrupted","paused","completed","cancelled"]);

function ensure(ok,message) {
  if(!ok) throw new Error("Missions : "+message);
}
function str(v,label,max=300) {
  ensure(typeof v==="string" && v.trim().length>0 && v.length<=max,
    label+" invalide");
  return v.trim();
}
function stamp(value) {
  str(value,"horodatage",35);
  ensure(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    && Number.isFinite(Date.parse(value)),"horodatage ISO avec fuseau requis");
  return value;
}
function repoName(value) {
  const name=str(value,"dépôt",150);
  ensure(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(name),"dépôt GitHub invalide");
  return name;
}
function repoLink(raw,repo,kind) {
  const u=new URL(str(raw,"lien GitHub",512));
  ensure(u.protocol==="https:" && u.hostname==="github.com" && !u.username &&
    !u.password && !u.search && !u.hash,"lien GitHub invalide");
  const prefix="/"+repo.toLowerCase()+"/";
  ensure(u.pathname.toLowerCase().startsWith(prefix),"dépôt GitHub différent");
  const suffix=u.pathname.slice(prefix.length);
  ensure(kind==="goal"
    ? /^(issues|pull)\/[1-9][0-9]*\/?$|^actions\/runs\/[1-9][0-9]*\/?$/.test(suffix)
    : /^pull\/[1-9][0-9]*\/?$/.test(suffix),"lien GitHub non autorisé");
  return u.toString();
}
function sha(value) {
  ensure(typeof value==="string" && /^[0-9a-f]{40}$/i.test(value),
    "SHA de commit requis");
  return value.toLowerCase();
}
function leaseId(v) {
  const s=str(v,"lease",80);
  ensure(/^[a-zA-Z0-9][a-zA-Z0-9._-]{15,79}$/.test(s),"lease opaque invalide");
  return s;
}
function timeMax(a,b) {return Date.parse(a)>=Date.parse(b);}
function expiry(at,seconds) {
  ensure(Number.isSafeInteger(seconds)&&seconds>=60&&seconds<=1800,
    "durée de lease entre 60 et 1800 secondes requise");
  return new Date(Date.parse(at)+seconds*1000).toISOString();
}
function trustedRunner(actor,mission,options) {
  if(MANAGERS.has(actor.role)) {
    ensure(mission.kind==="manual-work",
      "un responsable ne peut pas impersonner un exécuteur GitHub");
    return;
  }
  ensure(actor.role==="agent" && actor.id===mission.executorId &&
    mission.kind==="github-executor" &&
    Array.isArray(options.enabledExecutors) &&
    options.enabledExecutors.includes(actor.id),
  "exécuteur non autorisé ou non configuré");
}
function identity(command) {
  ensure(command.actor && typeof command.actor==="object","acteur obligatoire");
  const actor={id:str(command.actor.id,"identité",90),
    role:str(command.actor.role,"rôle",20)};
  ensure(MANAGERS.has(actor.role) || actor.role==="agent","rôle refusé");
  return actor;
}

export function emptyMissionLedger() {
  return {schemaVersion:1,revision:0,events:[],missions:[]};
}
export function nextMissionAction(mission) {
  const last=mission.checkpoints.at(-1);
  if(mission.status==="completed"||mission.status==="cancelled")
    return {action:"none",step:null};
  if(!last)return {action:"start-first-step",step:null};
  return last.phase==="before"
    ? {action:"inspect-before-retry",step:last.step}
    : {action:"next-step",step:last.step};
}

/** All authorization options are SERVER SUPPLIED, never copied from an API body.
 * This is a pure revisioned reducer, not durable until a CAS adapter commits it.
 */
export function applyMissionCommand(ledger,command,options={}) {
  ensure(ledger?.schemaVersion===1 && Number.isSafeInteger(ledger.revision) &&
    Array.isArray(ledger.events)&&Array.isArray(ledger.missions),
  "registre invalide");
  ensure(command && typeof command==="object","commande absente");
  const actor=identity(command);
  const eventId=str(command.eventId,"idempotence",100);
  const type=str(command.type,"action",30);
  const at=stamp(command.at);
  ensure(Number.isSafeInteger(command.expectedRevision)&&command.expectedRevision>=0,
    "révision attendue obligatoire");
  const fingerprint=createHash("sha256").update(JSON.stringify({
    type,at,actor,missionId:command.missionId??null,payload:command.payload??null,
  })).digest("hex");
  const prior=ledger.events.find(e=>e.id===eventId);
  if(prior){
    ensure(prior.fingerprint===fingerprint,"collision de clé d'idempotence");
    return structuredClone(ledger);
  }
  ensure(ledger.revision===command.expectedRevision,"conflit de révision");
  const next=structuredClone(ledger);
  let mission;
  const payload=command.payload??{};
  if(type==="register"){
    ensure(MANAGERS.has(actor.role),"enregistrement réservé au responsable");
    const goalId=str(payload.goalId,"objectif",80);
    ensure(Array.isArray(options.goalLedger?.goals),"registre d'objectifs requis");
    const goal=options.goalLedger.goals.find(g=>g.id===goalId);
    ensure(goal && goal.approvedAt &&
      ["approved","in-progress","blocked"].includes(goal.status),
      "seul un objectif approuvé peut devenir une mission");
    const repository=repoName(payload.repository);
    ensure(Array.isArray(options.authorizedRepos) &&
      options.authorizedRepos.some(r=>r.toLowerCase()===repository.toLowerCase()),
      "dépôt hors périmètre autorisé");
    ensure(Array.isArray(goal.links) &&
      goal.links.some(u=>{try {repoLink(u,repository,"goal");return true;}
        catch{return false;}}),
      "objectif sans référence GitHub pour ce dépôt");
    const kind=str(payload.kind,"mode",30);
    ensure(KINDS.has(kind),"mode non supporté");
    const executorId=kind==="manual-work"?null:str(payload.executorId,"agent",90);
    if(kind==="github-executor")ensure(
      Array.isArray(options.enabledExecutors) &&
      options.enabledExecutors.includes(executorId),
      "aucun exécuteur autorisé configuré");
    const missionId=str(payload.missionId,"mission",80);
    ensure(/^[a-z][a-z0-9._-]+$/i.test(missionId),"identifiant mission incorrect");
    ensure(!next.missions.some(m=>m.id===missionId),"mission déjà existante");
    ensure(!next.missions.some(m=>m.goalId===goalId &&
      !["completed","cancelled"].includes(m.status)),
      "un objectif a déjà une mission non terminée");
    ensure(!next.missions.some(m=>m.status==="running"),
      "une mission active existe déjà");
    mission={
      id:missionId,goalId,repository,kind,executorId,
      status:"planned",createdAt:at,updatedAt:at,
      checkpoints:[],lease:null,nextEligibleAt:null,blockedReason:null,
      completedAt:null,
      // Work user conversation id/URL/quotas intentionally not invented.
      conversationUrl:null,remainingQuota:null,quotaRenewsAt:null,
    };
    next.missions.push(mission);
  } else {
    const mid=str(command.missionId,"mission",80);
    mission=next.missions.find(m=>m.id===mid);
    ensure(mission && STATES.has(mission.status),"mission inconnue");
    ensure(timeMax(at,mission.updatedAt),"horodatage antérieur à l'état");
    if(type==="acquire"||type==="reclaim"){
      trustedRunner(actor,mission,options);
      ensure(type==="acquire"
        ? mission.status==="planned"||mission.status==="paused"
        : mission.status==="interrupted","état de reprise invalide");
      ensure(!mission.nextEligibleAt ||
        timeMax(at,mission.nextEligibleAt),"reprise avant éligibilité");
      ensure(!next.missions.some(m=>m.id!==mission.id&&RUNNING.has(m.status)),
        "une autre mission est déjà active");
      if(type==="reclaim")ensure(
        Number.isSafeInteger(payload.observedCheckpointCount)&&
        payload.observedCheckpointCount===mission.checkpoints.length,
        "lecture des checkpoints obligatoire avant reprise");
      mission.lease={id:leaseId(payload.leaseId),
        owner:actor.id,acquiredAt:at,expiresAt:expiry(at,payload.leaseSeconds)};
      mission.status="running";mission.nextEligibleAt=null;
    } else if(type==="checkpoint"||type==="heartbeat"||type==="complete"||
      type==="pause"){
      trustedRunner(actor,mission,options);
      ensure(mission.status==="running" && mission.lease &&
        mission.lease.owner===actor.id &&
        mission.lease.id===leaseId(payload.leaseId),
        "lease absente ou détenue par un autre agent");
      ensure(Date.parse(at)<Date.parse(mission.lease.expiresAt),
        "lease expirée : réconciliation requise");
      if(type==="heartbeat"){
        mission.lease.expiresAt=expiry(at,payload.leaseSeconds);
      } else if(type==="checkpoint"){
        const step=str(payload.step,"étape",80);
        ensure(/^[a-z][a-z0-9._-]*$/.test(step),"étape invalide");
        const phase=str(payload.phase,"phase",20);
        ensure(STAGES.has(phase),"phase inconnue");
        const last=mission.checkpoints.at(-1);
        if(phase==="before"){
          ensure(!last||last.phase==="after","étape précédente non vérifiée");
          ensure(!mission.checkpoints.some(c=>c.step===step),
            "étape déjà checkpointée");
        } else {
          ensure(last && last.phase==="before"&&last.step===step,
            "checkpoint après sans étape avant");
        }
        ensure(mission.checkpoints.length<200,"limite de checkpoints atteinte");
        const commit=payload.commit==null?null:sha(payload.commit);
        const pullRequest=payload.pullRequest==null?null:
          repoLink(payload.pullRequest,mission.repository,"pr");
        if(phase==="after")ensure(commit||pullRequest,
          "preuve GitHub requise après opération");
        mission.checkpoints.push({
          step,phase,at,commit,pullRequest,
          nextAction:payload.nextAction==null?null:
            str(payload.nextAction,"action suivante",250),
        });
      } else if(type==="complete"){
        const last=mission.checkpoints.at(-1);
        ensure(last?.phase==="after"&&(last.commit||last.pullRequest),
          "preuve d'étape terminée requise");
        mission.status="completed";mission.completedAt=at;mission.lease=null;
      } else {
        const reason=str(payload.reason,"motif d'interruption",350);
        const nextEligibleAt=payload.nextEligibleAt==null?null:
          stamp(payload.nextEligibleAt);
        if(nextEligibleAt)ensure(Date.parse(nextEligibleAt)>Date.parse(at),
          "éligibilité doit être future et documentée");
        mission.status="paused";mission.blockedReason=reason;
        mission.nextEligibleAt=nextEligibleAt;mission.lease=null;
      }
    } else if(type==="expire"){
      ensure(MANAGERS.has(actor.role),"watchdog non autorisé");
      ensure(mission.status==="running"&&mission.lease,
        "pas de lease active");
      ensure(Date.parse(at)>=Date.parse(mission.lease.expiresAt),
        "lease non expirée");
      mission.status="interrupted";mission.blockedReason="lease-expired";
      mission.lease=null;
    } else if(type==="cancel"){
      ensure(MANAGERS.has(actor.role),"annulation réservée au responsable");
      ensure(!["completed","cancelled"].includes(mission.status),
        "mission déjà terminée");
      mission.status="cancelled";
      mission.blockedReason=str(payload.reason,"motif",350);
      mission.lease=null;
    } else ensure(false,"commande inconnue");
    mission.updatedAt=at;
  }
  next.events.push({id:eventId,fingerprint,missionId:mission.id,
    type,at,actorId:actor.id,actorRole:actor.role});
  next.revision++;
  return next;
}
