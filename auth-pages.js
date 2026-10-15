import {getCloudClient} from './cloud-client.js';
const $=id=>document.getElementById(id);
let client,role=new URLSearchParams(location.search).get('role')==='teacher'?'teacher':'student',busy=false;
const status=(message,error=false)=>{const el=$('status');el.hidden=false;el.textContent=message;el.classList.toggle('error',error);};
const home=profile=>profile.mustChangePassword?'./change-password.html':profile.role==='teacher'?'./teacher/':'./';
function setRole(value){if(busy)return;role=value;$('student-tab').setAttribute('aria-pressed',String(role==='student'));$('teacher-tab').setAttribute('aria-pressed',String(role==='teacher'));$('identifier-label').textContent=role==='teacher'?'Öğretmen kullanıcı adı':'Öğrenci numarası';$('identifier').value=role==='teacher'?'ogretmen':'';$('identifier').inputMode=role==='teacher'?'text':'numeric';$('hint').textContent=role==='teacher'?'Kullanıcı adınız ogretmen. Öğrenci ekleme, şifre sıfırlama ve sonuç işlemlerini panelinizden yapabilirsiniz.':'İlk giriş şifren öğrenci numaranın son 6 hanesidir. İlk girişte yeni bir şifre belirlemen istenir. Şifreni unuttuysan öğretmeninden sıfırlamasını iste.';}
async function submit(event,work){event.preventDefault();if(busy)return;busy=true;$('submit').disabled=true;try{if(!client)throw Error('Supabase bağlantısı henüz yapılandırılmadı. Kurulum tamamlanınca giriş yapabilirsiniz.');status('İşlem yapılıyor…');await work();}catch(e){status(e.message||'İşlem tamamlanamadı.',true);}finally{busy=false;$('submit').disabled=false;}}
async function init(){
  try{client=await getCloudClient();if(!client)status('Supabase bağlantısı hazırlanıyor. Henüz giriş yapılamıyor.',true);}catch(e){status(e.message,true);}
  if($('login-form')){
    setRole(role);$('student-tab').onclick=()=>setRole('student');$('teacher-tab').onclick=()=>setRole('teacher');
    $('login-form').onsubmit=e=>submit(e,async()=>{const profile=await client.login({role,identifier:$('identifier').value,password:$('password').value});$('password').value='';location.assign(home(profile));});
  }
  const password=()=>{if($('new-password').value!==$('confirm-password').value)throw Error('İki şifre aynı olmalıdır.');return $('new-password').value;};
  if($('password-form')){
    if(client){try{await client.getProfile();}catch(e){if(e.status===401||e.status===400)location.replace('./login.html');else status(e.message,true);}}
    $('password-form').onsubmit=e=>submit(e,async()=>{const profile=await client.changePassword(password());$('new-password').value='';$('confirm-password').value='';location.assign(home(profile));});
    $('logout').onclick=()=>client?.signOut();
  }
  if($('setup-form')){
    const token=new URLSearchParams(location.hash.slice(1)).get('token');
    if(token){$('setup-token').value=token;$('token-field').hidden=true;history.replaceState(null,'',location.pathname+location.search);}
    $('setup-form').onsubmit=e=>submit(e,async()=>{await client.bootstrap($('setup-token').value,password());$('setup-token').value='';$('new-password').value='';$('confirm-password').value='';$('setup-form').hidden=true;status('Öğretmen hesabı oluşturuldu. Şimdi ogretmen kullanıcı adınız ve belirlediğiniz şifreyle giriş yapabilirsiniz.');const link=document.createElement('a');link.href='./login.html?role=teacher';link.textContent='Öğretmen girişine geç →';$('status').append(document.createElement('br'),link);});
  }
}
init();
