/* Shared services. No private keys belong in this file or connection.json. */
(()=>{'use strict';
 const editor=location.pathname.endsWith('/editor.html');
 const B=window.AmanecerBackend={enabled:false,site:null,revision:0,bookings:[],token:'',config:null};
 const errors={REVISION_CONFLICT:'Otra persona ha guardado cambios. Recarga antes de editar.',NO_AVAILABILITY:'No queda una mesa para ese horario.',NOTICE_REQUIRED:'Reserva con al menos 1 hora de antelación.',OUTSIDE_OPENING_HOURS:'Elige una llegada entre las 12:30 y las 21:30 en un día de apertura.',DEPOSIT_REQUIRED:'Esta reserva requiere anticipo. Los pagos online aún no están activados; contacta con el restaurante.',CONFIGURATION_REQUIRED:'Las reservas aún no están activadas.',INVALID_ACTION:'Esta reserva ya no admite ese cambio.',FORBIDDEN:'No tienes permiso para acceder.',BOT_CHECK_FAILED:'Repite la comprobación de seguridad.',TRY_LATER:'Demasiados intentos. Espera unos minutos.',INVALID_INPUT:'Revisa los datos del formulario.'};
 Object.assign(errors,{ADDITIONAL_DEPOSIT_REQUIRED:'El nuevo número de personas necesita un anticipo mayor. Contacta con el restaurante para gestionar el cambio.',CHECKOUT_EXPIRED:'El plazo de pago ha terminado. Inicia una nueva reserva.',DEPOSIT_CONSENT_REQUIRED:'Acepta las condiciones del anticipo antes de continuar.',PAYMENTS_NOT_CONFIGURED:'Los pagos todavía no están disponibles. Contacta con el restaurante.'});
 const friendly=e=>e?.message==='NOTICE_REQUIRED'?'Reserva con al menos '+(B.policy?.minimumNoticeMinutes||60)+' minutos de antelación.':errors[e?.message]||'No se ha podido completar la operación. Inténtalo de nuevo.';B.friendly=friendly;
 async function api(path,body,method='POST',staff=false){
  if(!B.config)throw Error('CONFIGURATION_REQUIRED');
  if(staff&&rememberedSession)await renewSession();
  const r=await fetch(B.config.supabaseUrl+path,{method,headers:{apikey:B.config.publishableKey,...(staff?{Authorization:'Bearer '+B.token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  const text=await r.text();let data;try{data=text?JSON.parse(text):null}catch{throw Error('SERVICE_UNAVAILABLE')}
  if(!r.ok)throw Error(data?.error_code||(errors[data?.code]?data.code:null)||data?.error||data?.message||'SERVICE_UNAVAILABLE');return data;
 }
 B.api=api;
 B.ready=fetch('connection.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('SERVICE_UNAVAILABLE');return r.json()}).then(c=>{
  if(c.enabled!==true)return;
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(c.supabaseUrl)||typeof c.publishableKey!=='string'||!c.publishableKey)throw Error('CONFIGURATION_REQUIRED');
  if(c.publishableKey.startsWith('sb_secret_'))throw Error('CONFIGURATION_REQUIRED');
  if(c.publishableKey.startsWith('eyJ')){try{const claim=JSON.parse(atob(c.publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(claim.role!=='anon')throw Error()}catch{throw Error('CONFIGURATION_REQUIRED')}}
  B.config=c;B.enabled=true;
 });
 B.ready.catch(()=>{});
 B.policyReady=B.ready.then(async()=>{if(!B.enabled)return;B.policy=await api('/rest/v1/rpc/read_booking_policy',{});if(B.policy.enabled&&!B.config.turnstileSiteKey)throw Error('CONFIGURATION_REQUIRED');if(window.AmanecerBookingRules)window.AmanecerBookingRules.minimumNoticeMinutes=B.policy.minimumNoticeMinutes;return B.policy});
 B.policyReady.catch(()=>{});
 const sessionKey='amanecer-admin-session-v1';let rememberedSession=null,renewal=null,authPromise,loadPromise;
 const readSession=()=>{try{const value=JSON.parse(localStorage.getItem(sessionKey));return value&&typeof value.access_token==='string'&&typeof value.refresh_token==='string'&&Number.isFinite(value.expires_at)&&Number.isFinite(value.remember_until)&&value.remember_until>Date.now()?value:null}catch{return null}};
 function keepSession(session,until=Date.now()+30*86400000){rememberedSession={access_token:session.access_token,refresh_token:session.refresh_token,expires_at:session.expires_at||Math.floor(Date.now()/1000)+(session.expires_in||3600),remember_until:until};B.token=session.access_token;try{localStorage.setItem(sessionKey,JSON.stringify(rememberedSession))}catch{}}
 function forgetSession(){rememberedSession=null;B.token='';try{localStorage.removeItem(sessionKey)}catch{}}
 async function renewSession(){if(renewal)return renewal;renewal=(async()=>{
  const refresh=async()=>{const saved=readSession()||rememberedSession;if(!saved||saved.remember_until<=Date.now()){forgetSession();throw Error('FORBIDDEN')}
   rememberedSession=saved;B.token=saved.access_token;if(saved.expires_at*1000>Date.now()+60000)return;
   try{const next=await api('/auth/v1/token?grant_type=refresh_token',{refresh_token:saved.refresh_token});keepSession(next,saved.remember_until)}catch(e){if(['refresh_token_not_found','refresh_token_already_used','session_not_found','invalid_grant'].includes(e.message))forgetSession();throw e}};
  if(navigator.locks)await navigator.locks.request(sessionKey,refresh);else await refresh();
 })().finally(()=>{renewal=null});return renewal}
 function sessionControls(){if(document.querySelector('.admin-logout'))return;const logout=document.createElement('button');logout.className='admin-logout';logout.textContent='Cerrar sesión';logout.onclick=async()=>{logout.disabled=true;try{await api('/auth/v1/logout?scope=local',{},'POST',true)}catch{}finally{forgetSession();location.reload()}};document.querySelector('.sidebar')?.append(logout);
  setInterval(()=>{if(!document.hidden)renewSession().catch(()=>{if(!B.token)location.reload()})},30000);
  addEventListener('storage',e=>{if(e.key===sessionKey&&!e.newValue){B.token='';location.reload()}});
 }
 async function login(){if(authPromise)return authPromise;
  authPromise=(async()=>{rememberedSession=readSession();if(rememberedSession){try{await renewSession();const staff=await api('/rest/v1/restaurant_staff?select=user_id',undefined,'GET',true);if(!staff?.length)throw Error('FORBIDDEN');sessionControls();return}catch{forgetSession()}}
  return new Promise(resolve=>{
   const dialog=document.createElement('dialog');dialog.className='connection-login';dialog.setAttribute('aria-labelledby','login-title');
   dialog.innerHTML='<form><h2 id="login-title">Tu restaurante, en un solo lugar.</h2><p>Accede con tu correo y contraseña.</p><label>Correo electrónico<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><label hidden>Código del correo<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}"></label><button type="submit">Entrar al panel</button><button type="button" class="password-help">Primer acceso o recuperar contraseña</button><p role="status"></p></form>';
   document.body.append(dialog);dialog.showModal();dialog.addEventListener('cancel',e=>e.preventDefault());
   const form=dialog.querySelector('form'),status=form.querySelector('[role=status]'),button=form.querySelector('[type=submit]'),help=form.querySelector('.password-help');let mode='password',pendingSession;
   help.onclick=()=>{mode='request';form.elements.password.required=false;form.elements.password.value='';form.elements.password.parentElement.hidden=true;help.hidden=true;button.textContent='Recibir código de recuperación';status.textContent='Solo se enviará un correo para establecer o recuperar tu contraseña.'};
   Object.assign(errors,{invalid_credentials:'El correo o la contraseña no son correctos.',otp_expired:'El código ha caducado. Recarga y solicita uno nuevo.',same_password:'Elige una contraseña diferente.',weak_password:'La contraseña no cumple los requisitos de seguridad.',over_email_send_rate_limit:'Espera unos minutos antes de pedir otro código.'});
   form.onsubmit=async e=>{e.preventDefault();button.disabled=true;try{
    const email=form.elements.email.value.trim();
    if(mode==='request'){await api('/auth/v1/otp',{email,create_user:false});mode='code';form.elements.email.readOnly=true;form.elements.code.parentElement.hidden=false;form.elements.code.required=true;button.textContent='Verificar código';status.textContent='Introduce el código que has recibido por correo.';form.elements.code.focus();return}
    if(mode==='set'){const value=form.elements.password.value;if(value!==form.elements.passwordConfirm.value){status.textContent='Las contraseñas no coinciden.';return}await api('/auth/v1/user',{password:value},'PUT',true);form.elements.password.value='';form.elements.passwordConfirm.value='';keepSession(pendingSession);sessionControls();dialog.close();dialog.remove();resolve();return}
    {const session=mode==='code'?await api('/auth/v1/verify',{email,token:form.elements.code.value.trim(),type:'email'}):await api('/auth/v1/token?grant_type=password',{email,password:form.elements.password.value});B.token=session.access_token;
     const staff=await api('/rest/v1/restaurant_staff?select=user_id',undefined,'GET',true);if(!staff?.length){B.token='';throw Error('FORBIDDEN')}
     pendingSession=session;form.elements.password.value='';
     if(mode==='code'){mode='set';form.elements.code.value='';form.elements.code.required=false;form.elements.code.parentElement.hidden=true;form.elements.password.parentElement.hidden=false;form.elements.password.required=true;form.elements.password.autocomplete='new-password';form.elements.password.minLength=10;const label=document.createElement('label');label.textContent='Repite la contraseña';const confirmation=document.createElement('input');confirmation.name='passwordConfirm';confirmation.type='password';confirmation.autocomplete='new-password';confirmation.minLength=10;confirmation.required=true;label.append(confirmation);button.before(label);button.textContent='Guardar contraseña y entrar';status.textContent='Introduce tu nueva contraseña. Se guardará de forma protegida en el servicio de acceso.';form.elements.password.focus()}else{dialog.close();dialog.remove();resolve()}
     if(mode!=='set'){keepSession(session);sessionControls()}
    }
   }catch(e){if(mode!=='set')B.token='';status.textContent=friendly(e)}finally{button.disabled=false}};
  });})();return authPromise;
 }
 B.loadSite=async(force=false)=>{await B.ready;if(!B.enabled)return null;if(editor)await login();if(loadPromise&&!force)return loadPromise;
  loadPromise=api('/rest/v1/site_documents?select=document,revision&id=eq.true',undefined,'GET').then(rows=>{if(rows?.[0]){B.site=rows[0].document;B.revision=rows[0].revision}return B.site});return loadPromise;
 };
 B.upload=async file=>{
  await B.ready;if(!B.enabled||!B.token)throw Error('FORBIDDEN');
  if(rememberedSession)await renewSession();
  const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'};
  const ext=extensions[file.type];if(!ext||file.size>50*1024*1024)throw Error('INVALID_INPUT');
  const name=crypto.randomUUID()+'.'+ext;
  const r=await fetch(B.config.supabaseUrl+'/storage/v1/object/restaurant-media/'+name,{method:'POST',headers:{apikey:B.config.publishableKey,Authorization:'Bearer '+B.token,'Content-Type':file.type},body:file,signal:AbortSignal.timeout(120000)});
  if(!r.ok)throw Error('SERVICE_UNAVAILABLE');return B.config.supabaseUrl+'/storage/v1/object/public/restaurant-media/'+name;
 };
 B.saveSite=async site=>{
  await B.loadSite();const copy=structuredClone(site);
  async function uploadEmbedded(node){for(const k of Object.keys(node)){const value=node[k];if(typeof value==='string'&&/^data:image\/(jpeg|png|webp);base64,/i.test(value)){node[k]=await B.upload(await(await fetch(value)).blob())}else if(value&&typeof value==='object')await uploadEmbedded(value)}}
  await uploadEmbedded(copy);B.revision=await api('/rest/v1/rpc/publish_site',{p_document:copy,p_revision:B.revision},'POST',true);B.site=copy;dispatchEvent(new Event('amanecer:site-change'));
 };
 B.refreshBookings=async()=>{
  await B.loadSite();if(!B.enabled)return;
  const rows=await api('/rest/v1/reservations?select=id,customer_name,phone,email,people,starts_at,status,cancellation_reason&order=starts_at.desc&limit=500',undefined,'GET',true);
  B.bookings=rows.map(r=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(r.starts_at)).map(x=>[x.type,x.value]));return {reference:r.id,name:r.customer_name,phone:r.phone,email:r.email,people:r.people,date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute,status:r.status,cancellationReason:r.cancellation_reason}});
  dispatchEvent(new Event('amanecer:bookings-change'));
 };
 B.cancel=async id=>{await api('/rest/v1/rpc/staff_cancel_service_booking',{p_id:id},'POST',true);await B.refreshBookings()};
 B.noShow=async id=>{await api('/rest/v1/rpc/staff_mark_no_show',{p_id:id},'POST',true);await B.refreshBookings()};
 async function operationControls(){
  const host=document.querySelector('#bookings');const settings=document.createElement('form');settings.className='surface';
  settings.innerHTML='<h3>Reglas de las mesas</h3><label>Antelación mínima (minutos)<input name="notice" type="number" min="60" max="10080" required></label><label>Duración de la mesa (minutos)<input name="duration" type="number" min="30" max="360" required></label><button type="submit">Guardar reglas</button><p role="status"></p>';
  const config=(await api('/rest/v1/restaurant_settings?select=minimum_notice_minutes,meal_duration_minutes&id=eq.true',undefined,'GET',true))[0];settings.elements.notice.value=config.minimum_notice_minutes;settings.elements.duration.value=config.meal_duration_minutes;host.append(settings);
  settings.onsubmit=async e=>{e.preventDefault();const message=settings.querySelector('[role=status]'),button=settings.querySelector('button');button.disabled=true;try{await api('/rest/v1/restaurant_settings?id=eq.true',{minimum_notice_minutes:Number(settings.elements.notice.value),meal_duration_minutes:Number(settings.elements.duration.value)},'PATCH',true);message.textContent='Reglas actualizadas. Se aplicarán a las nuevas reservas y cambios.'}catch(e){message.textContent=friendly(e)}finally{button.disabled=false}};
  const delivery=document.createElement('section');delivery.className='surface';host.append(delivery);
  async function notices(){try{const rows=await api('/rest/v1/notification_outbox?select=id,state,attempts,reservation_id&state=neq.delivered&order=created_at.desc&limit=50',undefined,'GET',true);delivery.replaceChildren();const heading=document.createElement('h3');heading.textContent='Avisos por correo';delivery.append(heading);if(!rows.length){const p=document.createElement('p');p.textContent='No hay avisos pendientes.';delivery.append(p)}for(const r of rows){const p=document.createElement('p');p.textContent=r.reservation_id+' · '+(r.state==='failed'?'Envío pendiente de reintento':'Pendiente de entrega');delivery.append(p);if(r.state==='failed'){const retry=document.createElement('button');retry.textContent='Reintentar aviso';retry.onclick=async()=>{retry.disabled=true;try{await api('/rest/v1/rpc/retry_booking_notice',{p_id:r.id},'POST',true);await notices()}catch(e){p.textContent=friendly(e);retry.disabled=false}};delivery.append(retry)}}}catch{delivery.textContent='No se ha podido comprobar la entrega de avisos.'}}
  await notices();setInterval(()=>{if(!document.hidden)notices()},30000);
 }
 B.book=async data=>api('/functions/v1/book',data);
 B.manage=async data=>api('/functions/v1/manage',data);
 B.ready.then(()=>{if(B.enabled&&!editor)setInterval(async()=>{if(document.hidden)return;try{const before=JSON.stringify(B.site);await B.loadSite(true);if(JSON.stringify(B.site)!==before)dispatchEvent(new Event('amanecer:site-change'))}catch{}},30000)}).catch(()=>{});
 if(editor)B.ready.then(async()=>{if(!B.enabled)return;await login();await B.refreshBookings();
  document.querySelector('.local-demo-notice').hidden=true;
  document.querySelector('.sidebar>p').textContent='Administración privada · Datos compartidos';
  document.querySelector('#bookings .section-heading p').textContent='Reservas compartidas. Al cancelar se libera la mesa y se preparan los avisos por correo.';
  document.querySelector('#customers .section-heading p').textContent='Contactos de las reservas del restaurante.';
  document.querySelector('#content .section-heading p').textContent='Los cambios guardados se publican para todos los visitantes.';
  document.querySelector('.publish-instructions').hidden=true;document.querySelector('.quick [data-go=bookings] span').textContent='Consulta y gestiona las reservas compartidas.';
  document.querySelector('.backup>p').textContent='Exporta una copia de carta, textos y multimedia. Las copias de la base de datos se gestionan en Supabase según el plan contratado.';
  document.querySelector('.backup>a').hidden=true;
  document.querySelector('#export').textContent='Exportar copia del contenido';
  document.querySelector('#export-content').textContent='Exportar textos y multimedia';
  document.querySelector('#export-catalog').textContent='Exportar carta';
  operationControls().catch(()=>{document.querySelector('#save-state').textContent='No se han podido cargar las reglas de reservas.'});
  const mediaNote=document.querySelector('.media-manager .hint');if(mediaNote)mediaNote.textContent='Guarda para publicar fotos, vídeos y textos para todos los visitantes.';
  setInterval(()=>{if(!document.hidden)B.refreshBookings().catch(()=>{document.querySelector('#save-state').textContent='No se han podido actualizar las reservas.'})},15000);
 }).catch(e=>{document.querySelector('#save-state').textContent=friendly(e);document.querySelectorAll('main button').forEach(b=>b.disabled=true)});
})();
