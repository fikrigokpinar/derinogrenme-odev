// Display decisions use the same server-aligned clock as submission checks.
export function initialAssignment(forms, requestedId, statusFor) {
  const requested = forms.find(item => item.id === requestedId);
  return (requested && statusFor(requested.id).isOpen ? requested : null)
    || forms.find(item => statusFor(item.id).isOpen) || requested || forms[0] || null;
}

export function deliveryPhase(status) {
  if (status?.isOpen) return 'active';
  const deadline = Date.parse(status?.deadline), now = Date.parse(status?.serverNow);
  return status?.reason === 'expired' || (Number.isFinite(deadline) && Number.isFinite(now) && now >= deadline) ? 'expired' : 'inactive';
}

export function deadlineCountdown(status) {
  if (!status?.isOpen || !status.deadline) return null;
  const difference = Date.parse(status.deadline) - Date.parse(status.serverNow);
  if (!Number.isFinite(difference)) return null;
  const totalSeconds = Math.max(0, Math.ceil(difference / 1000));
  return {totalSeconds, days:Math.floor(totalSeconds / 86400), hours:Math.floor(totalSeconds / 3600) % 24,
    minutes:Math.floor(totalSeconds / 60) % 60, seconds:totalSeconds % 60, urgent:totalSeconds <= 86400};
}

export function assignmentScreen(forms, selectedId, statusFor) {
  const selected = forms.find(item => item.id === selectedId);
  const status = selected ? statusFor(selected.id) : null;
  const seen = new Set();
  const available = [];
  for (const item of forms) {
    if (!statusFor(item.id).isOpen || seen.has(item.homework_id)) continue;
    seen.add(item.homework_id);
    // A teacher preview can carry all variants; keep its selected variant when
    // moving between titles. Student snapshots carry only assigned variants.
    available.push(forms.find(candidate => candidate.homework_id === item.homework_id &&
      candidate.variant === selected?.variant && statusFor(candidate.id).isOpen) || item);
  }
  const phase = selected ? deliveryPhase(status) : 'inactive';
  return {phase, available, status,
    title:phase === 'expired' ? 'Bu ödevin süresi doldu' : available.length ? 'Bu ödev şu anda aktif değil' : 'Şu anda aktif ödeviniz yok',
    message:phase === 'expired' ? 'Son gönderim tarihi geçtiği için sorular kapatıldı. Yeni yanıt gönderilemez.'
      : available.length ? 'Bu ödev öğretmeniniz tarafından açıldığında sorulara ulaşabilirsiniz. Açık olan diğer ödevlerinize devam edebilirsiniz.'
      : 'Öğretmeniniz bir ödevi aktif ettiğinde sorular burada görünecek. Şu an göndermeniz gereken açık bir ödev bulunmuyor.'};
}
