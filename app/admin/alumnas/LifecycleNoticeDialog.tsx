"use client";

import { useState } from "react";

import NoticeDialog from "@/app/admin/components/NoticeDialog";

const messages: Record<
  string,
  {
    eyebrow: string;
    title: string;
    message: string;
    tone: "success" | "warning" | "info" | "error";
  }
> = {
  active: {
    eyebrow: "Alumna reactivada",
    title: "El expediente vuelve a estar activo",
    message: "Conservamos el mismo expediente y el acceso del estudio puede volver a utilizarse.",
    tone: "success",
  },
  inactive: {
    eyebrow: "Alumna inactiva",
    title: "El expediente quedó inactivo",
    message:
      "Conservamos todo el historial. Las reservas futuras fueron canceladas por el estudio sin penalización.",
    tone: "info",
  },
  deleted: {
    eyebrow: "Alumna eliminada",
    title: "El expediente fue eliminado de la operación",
    message:
      "No podrá reactivarse. Si la persona vuelve, Studio Flow permitirá registrarla como una alumna nueva.",
    tone: "warning",
  },
  lifecycle_error: {
    eyebrow: "No se pudo cambiar el estado",
    title: "El expediente no fue modificado",
    message: "Revisa el estado actual de la alumna e inténtalo nuevamente.",
    tone: "error",
  },
  delete_error: {
    eyebrow: "No se pudo eliminar",
    title: "El expediente sigue disponible",
    message:
      "No se completó la eliminación. No se aplicó una eliminación parcial desde esta pantalla.",
    tone: "error",
  },
};

export default function LifecycleNoticeDialog({
  lifecycle,
  notice,
  error,
}: {
  lifecycle?: string;
  notice?: string;
  error?: string;
}) {
  const errorKey =
    error === "lifecycle" ? "lifecycle_error" : error === "delete_student" ? "delete_error" : "";
  const key = errorKey || lifecycle || notice || "";
  const config = messages[key];
  const [open, setOpen] = useState(Boolean(config));

  if (!config || !open) return null;

  function close() {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("lifecycle");
    url.searchParams.delete("notice");
    if (errorKey) url.searchParams.delete("error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <NoticeDialog
      eyebrow={config.eyebrow}
      title={config.title}
      tone={config.tone}
      onConfirm={close}
    >
      {config.message}
    </NoticeDialog>
  );
}
