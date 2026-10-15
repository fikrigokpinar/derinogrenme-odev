import {FEEDBACK_STATUSES} from './teacher/feedback-model.js';

const clone = value => JSON.parse(JSON.stringify(value));
const node = (tag, cls = '', text = '') => {
  const el = document.createElement(tag); el.className = cls; el.textContent = text; return el;
};
const dateLabel = value => new Intl.DateTimeFormat('tr-TR',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Istanbul'}).format(new Date(value));
export function validateFeedbackView(view) {
  if (!view || typeof view.settings?.enabled !== 'boolean' || !Array.isArray(view.settings.categories) ||
      !Array.isArray(view.contexts) || !Array.isArray(view.items)) throw new Error('Geri bildirimler yüklenemedi. Yeniden dene.');
  return view;
}

// A retry always reuses the same immutable request, even after a page reload.
// This queue is independent of homework attempts and never replaces code drafts.
export class FeedbackClient {
  constructor(client, {termId,studentId,cache=null}) {
    this.client=client; this.termId=termId; this.cache=cache;
    this.cacheKey=`tensor-feedback-pending:${studentId}:${termId}`; this.pending=null; this.sending=false;
    try {
      const saved=JSON.parse(cache?.getItem(this.cacheKey)||'null');
      if(saved?.termId===termId && typeof saved.requestId==='string' && typeof saved.message==='string' && saved.message.length<=3000) this.pending=saved;
    } catch (_) { /* Private browsing can disable storage. */ }
  }
  remember() { try { this.cache?.setItem(this.cacheKey,JSON.stringify(this.pending)); } catch (_) {} }
  async load() { return validateFeedbackView(await this.client.api('student-feedback-state',{termId:this.termId})); }
  async submit(value) {
    if(this.sending) throw new Error('Geri bildirimin kaydediliyor.');
    this.sending=true;
    try {
      if(!this.pending) {
        this.pending={termId:this.termId,requestId:crypto.randomUUID(),categoryId:value.categoryId,
          message:value.message.trim(),homeworkId:value.homeworkId||null,taskId:value.taskId||null};
        this.remember();
      }
      const response=await this.client.api('student-feedback-submit',clone(this.pending));
      const view=validateFeedbackView(response);
      this.pending=null; this.remember(); return view;
    } catch(error) {
      if(error?.status>=400 && error.status<500 && error.status!==408) { this.pending=null; this.remember(); }
      throw error;
    } finally { this.sending=false; }
  }
}

export function createPreviewFeedbackClient(loadPreview) {
  const items=[];
  return {pending:null,async load() { return {...await loadPreview(),items:clone(items)}; },async submit(input) {
    const view=await this.load(),context=view.contexts.find(c=>c.homeworkId===input.homeworkId),category=view.settings.categories.find(c=>c.id===input.categoryId);
    const item={id:crypto.randomUUID(),categoryId:input.categoryId,categoryLabel:category?.label||'',message:input.message.trim(),
      homeworkId:context?.homeworkId||null,homeworkTitle:context?.title||'',taskId:input.taskId||null,
      taskTitle:context?.tasks.find(t=>t.id===input.taskId)?.title||'',status:'new',createdAt:new Date().toISOString()};
    items.unshift(item); return {...view,items:clone(items),submittedId:item.id};
  }};
}

export function mountFeedback({client,preview=false,getCurrentContext=()=>({})}) {
  const trigger=node('button','toolbar-button','Geri bildirim'); trigger.type='button'; trigger.id='feedback-open';
  document.querySelector('.preview-controls').prepend(trigger);
  let dialog=null, view=null, draft={categoryId:'',homeworkId:'',taskId:'',message:''};
  const field=(label,input)=>{const wrap=node('label','student-feedback-field');wrap.append(node('span','',label),input);return wrap;};
  const button=(label,cls,fn)=>{const el=node('button',cls,label);el.type='button';el.addEventListener('click',fn);return el;};
  const option=(value,label)=>{const el=node('option','',label);el.value=value;return el;};
  function renderHistory(root) {
    const list=node('section','student-feedback-history');
    const heading=node('h3','',`Gönderdiklerin (${view.items.length})`); list.append(heading);
    if(!view.items.length) list.append(node('p','student-feedback-help','Henüz geri bildirim göndermedin.'));
    for(const item of [...view.items].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))) {
      const card=node('article','student-feedback-item'),top=node('div','student-feedback-item-top');
      top.append(node('strong','',item.categoryLabel),node('span',`student-feedback-status ${item.status}`,FEEDBACK_STATUSES[item.status]||'Yeni'));
      card.append(top,node('p','student-feedback-meta',`${dateLabel(item.createdAt)} · Türkiye saati`));
      if(item.homeworkTitle) card.append(node('p','student-feedback-meta',`${item.homeworkTitle}${item.taskId?' · '+item.taskId:''}`));
      card.append(node('p','student-feedback-message',item.message));
      if(item.teacherReply?.message) {
        const reply=node('section','student-feedback-reply');
        reply.append(node('h4','','Öğretmeninin cevabı'),node('p','student-feedback-message',item.teacherReply.message));
        const edited=item.teacherReply.revision>1;
        reply.append(node('p','student-feedback-meta',`${edited?'Güncellendi':'Cevaplandı'}: ${dateLabel(item.teacherReply.updatedAt)} · Türkiye saati`));
        card.append(reply);
      } else card.append(node('p','student-feedback-meta','Öğretmenin henüz cevap yazmadı.'));
      list.append(card);
    }
    root.append(list);
  }
  function render(body,success='') {
    body.replaceChildren();
    if(preview) body.append(node('p','student-feedback-notice','Öğretmen önizlemesi: Buradaki denemeler gerçek bildirim oluşturmaz.'));
    else body.append(node('p','student-feedback-help','Adın ve öğrenci numaran öğretmenin tarafından görülür. Diğer öğrenciler bildirimini göremez. Geri bildirim göndermek ödev hakkını veya puanını değiştirmez.'));
    if(success){const done=node('p','student-feedback-success',success);done.setAttribute('role','status');body.append(done);}
    const canSend=view.settings.enabled && view.settings.categories.some(c=>c.enabled!==false);
    if(!canSend && !client.pending) {
      body.append(node('p','student-feedback-notice','Öğretmenin şu anda yeni geri bildirim alımını kapattı. Önceki bildirimlerini aşağıda görebilirsin.'));
      renderHistory(body);return;
    }
    const form=node('form','student-feedback-form');
    const category=node('select');category.required=true;category.setAttribute('aria-label','Geri bildirim kategorisi');
    category.append(option('','Kategori seç'));
    for(const item of view.settings.categories.filter(c=>c.enabled!==false)){
      const entry=option(item.id,item.label);entry.disabled=!!item.requiresQuestion&&!view.contexts.length;category.append(entry);
    }
    const categoryHint=node('p','student-feedback-help');categoryHint.id='feedback-category-help';category.setAttribute('aria-describedby',categoryHint.id);
    const homework=node('select');homework.setAttribute('aria-label','İlgili çalışma');homework.append(option('','Genel / bir çalışmaya bağlı değil'));
    for(const context of view.contexts)homework.append(option(context.homeworkId,context.title));
    const task=node('select');task.setAttribute('aria-label','İlgili soru');const taskWrap=field('İlgili soru',task);
    const message=node('textarea');message.rows=5;message.maxLength=3000;message.required=true;message.setAttribute('aria-label','Geri bildirimin');
    message.placeholder='Neyin anlaşılmadığını, yaşadığın sorunu veya değiştirilmesini önerdiğin noktayı yaz.';
    const count=node('p','student-feedback-count'),error=node('p','student-feedback-error');error.setAttribute('role','alert');
    const pending=client.pending;
    if(pending)draft={categoryId:pending.categoryId,homeworkId:pending.homeworkId||'',taskId:pending.taskId||'',message:pending.message};
    category.value=draft.categoryId;homework.value=draft.homeworkId;message.value=draft.message;
    if(pending && !category.value)category.append(option(pending.categoryId,'Önceki gönderimin kategorisi'));
    if(pending)category.value=pending.categoryId;
    function updateTasks() {
      const previous=draft.taskId,context=view.contexts.find(c=>c.homeworkId===homework.value);
      task.replaceChildren(option('','Soru seç / çalışmanın geneli'));
      for(const item of context?.tasks||[])task.append(option(item.id,`${item.id} · ${item.title}`));
      task.value=(context?.tasks||[]).some(t=>t.id===previous)?previous:'';
      taskWrap.hidden=!context;draft.taskId=task.value;updateCategory();
    }
    function updateCategory() {
      const selected=view.settings.categories.find(c=>c.id===category.value);
      categoryHint.textContent=selected?.description||'Geri bildiriminin en çok ilgili olduğu başlığı seç.';
      homework.required=!!selected?.requiresQuestion;task.required=!!selected?.requiresQuestion;
    }
    category.onchange=()=>{
      draft.categoryId=category.value;
      if(view.settings.categories.find(c=>c.id===category.value)?.requiresQuestion && !homework.value){
        const current=getCurrentContext(),context=view.contexts.find(c=>c.homeworkId===current.homeworkId);
        if(context){homework.value=context.homeworkId;draft.homeworkId=context.homeworkId;draft.taskId=current.taskId||'';updateTasks();}
      }
      updateCategory();
    };
    homework.onchange=()=>{draft.homeworkId=homework.value;draft.taskId='';updateTasks();};
    task.onchange=()=>{draft.taskId=task.value;};
    message.oninput=()=>{draft.message=message.value;count.textContent=`${message.value.length} / 3000 karakter`;};
    message.oninput();updateTasks();
    form.append(field('Kategori',category),categoryHint,field('İlgili çalışma',homework),taskWrap,field('Geri bildirimin',message),count,error);
    const send=button(pending?'Aynı gönderimi yeniden dene':preview?'Gönderimi dene':'Geri bildirimi gönder','action-button grade',()=>form.requestSubmit());
    form.append(send);
    if(pending){for(const control of [category,homework,task,message])control.disabled=true;
      form.prepend(node('p','student-feedback-notice','Önceki gönderimin sonucu doğrulanamadı. Aynı gönderimi yeniden dene; ikinci bir kayıt oluşturulmaz.'));
    }
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!pending && !message.value.trim()){error.textContent='Lütfen geri bildirimini yaz.';message.focus();return;}
      if(!pending && task.required && (!homework.value||!task.value)){error.textContent='Bu kategori için ilgili çalışmayı ve soruyu seç.';return;}
      dialog.dataset.sending='true';send.disabled=true;send.textContent='Kaydediliyor…';
      const value={categoryId:category.value,homeworkId:homework.value,taskId:task.value,message:message.value};
      for(const control of [category,homework,task,message])control.disabled=true;
      try {
        view=await client.submit(value);draft={categoryId:'',homeworkId:'',taskId:'',message:''};
        render(body,preview?'Önizleme tamamlandı. Gerçek bildirim oluşturulmadı.':'Geri bildirimin öğretmenine iletildi. Durumunu aşağıdan takip edebilirsin.');
      } catch(failure) {
        render(body);
        const failureAlert=body.querySelector('[role="alert"]')||node('p','student-feedback-error');
        failureAlert.setAttribute('role','alert');
        failureAlert.textContent=failure?.message||'Geri bildirim kaydedilemedi. Tekrar dene.';
        if(!failureAlert.parentNode) body.prepend(failureAlert);
      } finally { delete dialog.dataset.sending; }
    });
    body.append(form);renderHistory(body);
  }
  async function open() {
    if(dialog?.open)return;
    dialog=node('dialog','student-feedback-dialog');dialog.setAttribute('aria-labelledby','feedback-heading');
    const head=node('div','student-feedback-head'),heading=node('h2','','Geri bildirim');heading.id='feedback-heading';
    const close=button('×','student-feedback-close',()=>{if(!dialog.dataset.sending)dialog.close();});close.setAttribute('aria-label','Geri bildirimi kapat');head.append(heading,close);
    const body=node('div','student-feedback-body');
    const refresh=button('Bildirimleri yenile','toolbar-button',()=>load());
    const foot=node('div','student-feedback-foot');foot.append(refresh,button('Kapat','toolbar-button',()=>{if(!dialog.dataset.sending)dialog.close();}));
    dialog.append(head,body,foot);dialog.addEventListener('cancel',e=>{if(dialog.dataset.sending)e.preventDefault();});
    dialog.addEventListener('close',()=>{dialog.remove();dialog=null;trigger.focus();});document.body.append(dialog);dialog.showModal();
    async function load() {
      if(dialog.dataset.sending)return;
      body.replaceChildren(node('p','student-feedback-help','Geri bildirimler yükleniyor…'));refresh.disabled=true;
      try { view=validateFeedbackView(await client.load()); if(dialog?.open)render(body); }
      catch(error){if(dialog?.open){const alert=node('p','student-feedback-error',error?.message||'Bağlantı kurulamadı. Bildirimleri yenile düğmesini kullan.');alert.setAttribute('role','alert');body.replaceChildren(alert);}}
      finally{refresh.disabled=false;}
    }
    await load();
  }
  trigger.addEventListener('click',open);
  return trigger;
}
