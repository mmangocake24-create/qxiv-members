
(function(){
  if(window.location.pathname.indexOf('dashboard')===-1)return;

  function set(id,val){var e=document.getElementById(id);if(e)e.textContent=val;}
  function setStyle(id,prop,val){var e=document.getElementById(id);if(e)e.style[prop]=val;}

  function showAuthError(msg){
    msg=msg||'セッションが切れました。再度ログインしてください。';
    try{document.body.innerHTML='<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FAFAF7;font-family:sans-serif;"><div style="text-align:center;padding:40px;"><div style="font-size:32px;margin-bottom:16px;">⚠️</div><div style="font-size:14px;color:#3D3D3D;margin-bottom:20px;">'+msg+'</div><a href="/login" style="padding:10px 24px;background:#A91B0D;color:white;border-radius:4px;text-decoration:none;font-size:13px;font-weight:700;">ログインページへ</a></div></div>';}catch(e2){}
  }

  var API='https://api.qxiv.org';
  var token=localStorage.getItem('qxiv_token');
  if(!token){window.location.href='/login';return;}

  var ROLE_MAP={admin:'事務局',banker:'バンカー',signer:'サイナー'};
  var RANK_MAP={bronze:'ブロンズ',silver:'シルバー',gold:'ゴールド',platinum:'プラチナ'};
  var CAT_MAP={rules:'規約・重要情報',cases:'案件情報',general:'お知らせ',content:'コンテンツ',personal:'専用記事'};
  var THUMB_ICONS={rules:'📋',cases:'💼',general:'📢',content:'📖',personal:'⭐'};
  var isAdmin=false,allMembers=[],allAdminArticles=[],currentPanel='overview';

  // ★ 通知用: localStorageキー
  var NOTIF_READ_KEY='qxiv_notif_read';

  var now=new Date(),wd=['日','月','火','水','木','金','土'];
  set('topbar-date',now.getFullYear()+'年'+(now.getMonth()+1)+'月'+now.getDate()+'日（'+wd[now.getDay()]+'）');

  var _attempts=parseInt(sessionStorage.getItem('_dash_err')||'0');
  if(_attempts>=3){
    sessionStorage.removeItem('_dash_err');
    localStorage.removeItem('qxiv_token');localStorage.removeItem('qxiv_refresh');localStorage.removeItem('qxiv_user');
    showAuthError('ログインに繰り返し失敗しました。再度ログインしてください。');return;
  }

  fetch(API+'/api/me',{headers:{'Authorization':'Bearer '+token}})
    .then(function(r){
      if(r.status===401){
        sessionStorage.setItem('_dash_err',_attempts+1);
        localStorage.removeItem('qxiv_token');localStorage.removeItem('qxiv_refresh');localStorage.removeItem('qxiv_user');
        showAuthError('認証の有効期限が切れました。再度ログインしてください。');return null;
      }
      if(!r.ok){sessionStorage.setItem('_dash_err',_attempts+1);showAuthError('サーバーエラー（'+r.status+'）が発生しました。');return null;}
      return r.json();
    })
    .then(function(data){
      if(!data)return;
      sessionStorage.removeItem('_dash_err');
      var p=data.profile;
      if(!p){showAuthError('プロフィール情報の取得に失敗しました。');return;}
      isAdmin=p.role==='admin';
      renderUser(p);
      loadArticles();
      loadReferral();
      if(isAdmin){loadAdminData();loadAdminArticles();loadAdminRanking();}
      if(!isAdmin&&p.role==='banker'){loadDashRanking();loadBankerContent();}
      setStyle('qxiv-app','display','block');
    })
    .catch(function(e){
      sessionStorage.setItem('_dash_err',_attempts+1);
      showAuthError('通信エラーが発生しました。<br><small style="color:#999;">'+(e.message||'不明')+'</small>');
    });

  function renderUser(p){
    var role=ROLE_MAP[p.role]||p.role,rank=RANK_MAP[p.rank]||p.rank;
    set('sb-badge',role.toUpperCase());set('sb-name',p.full_name||'QXIV会員');set('sb-rank',rank);
    if(isAdmin){
      setStyle('admin-nav','display','block');setStyle('admin-dash','display','block');
      set('nav-articles-label','ブログ・記事管理');set('articles-panel-title','ブログ・記事管理');
    } else {
      setStyle('member-dash-banker','display','block');
      set('stat-member-no',p.member_no||'—');set('stat-rank',rank);
    }
    var av=document.getElementById('pf-avatar');if(av)av.textContent=(p.full_name||'会').charAt(0);
    set('pf-name',p.full_name||'—');
    var tb=document.getElementById('pf-type-badge'),rb=document.getElementById('pf-rank-badge');
    if(tb)tb.textContent=role;if(rb)rb.textContent=rank;
    var reg=p.reg_date?new Date(p.reg_date).toLocaleDateString('ja-JP'):'—';
    var exp=p.expiry_date?new Date(p.expiry_date).toLocaleDateString('ja-JP'):'—';
    var fields=[['会員番号',p.member_no],['氏名',p.full_name],['フリガナ',p.kana_name],['法人名',p.corp_name],
      ['種別',role],['ランク',rank],['登録日',reg],['有効期限',exp]];
    var pf=document.getElementById('profile-fields');
    if(pf)pf.innerHTML=fields.map(function(f){
      return '<div class="pf-row"><span class="pf-key">'+f[0]+'</span><span class="pf-val">'+(f[1]||'—')+'</span></div>';
    }).join('');
  }

  // ★ 通知バッジ更新
  function updateNotifBadge(count){
    var els=['bell-badge','bell-tab-badge','notif-nav-badge'];
    els.forEach(function(id){
      var e=document.getElementById(id);
      if(!e)return;
      if(count>0){e.textContent=count>99?'99+':count;e.style.display='inline';}
      else{e.style.display='none';}
    });
    var ma=document.getElementById('notif-mark-all');
    if(ma)ma.style.display=count>0?'block':'none';
  }

  // ★ 通知一覧レンダリング（generalカテゴリをお知らせとして扱う）
  function renderNotifications(arts){
    var notifs=arts.filter(function(a){return a.category==='general'||a.category==='rules';});
    var readIds=JSON.parse(localStorage.getItem(NOTIF_READ_KEY)||'[]');
    var unreadCount=notifs.filter(function(a){return readIds.indexOf(a.id)===-1;}).length;
    updateNotifBadge(unreadCount);

    var el=document.getElementById('notifications-list');if(!el)return;
    if(!notifs.length){
      el.innerHTML='<div class="card" style="text-align:center;padding:32px;font-size:13px;color:var(--ink-faint);">お知らせはありません</div>';
      return;
    }
    el.innerHTML=notifs.map(function(a){
      var isRead=readIds.indexOf(a.id)!==-1;
      var d=a.published_at?new Date(a.published_at).toLocaleDateString('ja-JP'):'';
      var cat=CAT_MAP[a.category]||a.category;
      var icon=a.category==='rules'?'📋':'📢';
      var dotColor=a.category==='rules'?'var(--red)':'var(--gold)';
      return '<div class="card" style="margin-bottom:10px;padding:14px 16px;cursor:pointer;opacity:'+(isRead?'0.6':'1')+';border-left:3px solid '+(isRead?'var(--border)':dotColor)+';" onclick="readNotif(\''+a.id+'\')">'
        +'<div style="display:flex;align-items:flex-start;gap:12px;">'
        +(isRead?'':'<div style="width:8px;height:8px;border-radius:50%;background:'+dotColor+';flex-shrink:0;margin-top:5px;"></div>')
        +(isRead?'<div style="width:8px;flex-shrink:0;"></div>':'')
        +'<div style="flex:1;min-width:0;">'
        +'<div style="font-size:13px;font-weight:'+(isRead?'500':'700')+';color:var(--ink);margin-bottom:4px;line-height:1.4;">'+esc(a.title)+'</div>'
        +'<div style="display:flex;align-items:center;gap:8px;">'
        +'<span style="font-size:10px;">'+icon+'</span>'
        +'<span class="badge badge-gray" style="font-size:10px;">'+cat+'</span>'
        +'<span style="font-size:11px;color:var(--ink-faint);">'+d+'</span>'
        +'</div>'
        +(a.body?'<div style="font-size:12px;color:var(--ink-muted);margin-top:8px;line-height:1.6;max-height:60px;overflow:hidden;">'+esc(a.body.substring(0,120))+(a.body.length>120?'...':'')+'</div>':'')
        +'</div></div></div>';
    }).join('');
  }

  // ★ 通知を既読にする
  window.readNotif=function(id){
    var readIds=JSON.parse(localStorage.getItem(NOTIF_READ_KEY)||'[]');
    if(readIds.indexOf(id)===-1){readIds.push(id);localStorage.setItem(NOTIF_READ_KEY,JSON.stringify(readIds));}
    // 再レンダリング
    var arts=window._cachedArticles||[];
    renderNotifications(arts);
  };

  // ★ すべて既読
  window.markAllNotifRead=function(){
    var arts=(window._cachedArticles||[]).filter(function(a){return a.category==='general'||a.category==='rules';});
    var ids=arts.map(function(a){return a.id;});
    localStorage.setItem(NOTIF_READ_KEY,JSON.stringify(ids));
    renderNotifications(arts);
  };

  function loadArticles(){
    fetch(API+'/api/articles',{headers:{'Authorization':'Bearer '+token}})
      .then(function(r){return r.json();})
      .then(function(data){
        var arts=data.articles||[];
        window._cachedArticles=arts; // ★ キャッシュ
        if(isAdmin){renderArticlesPreview(arts.slice(0,5));}
        renderArticlesList(arts);
        renderNotifications(arts); // ★ 通知を更新
        if(!isAdmin){
          var readIds=JSON.parse(localStorage.getItem('qxiv_read')||'[]');
          set('dash-unread',arts.filter(function(a){return readIds.indexOf(a.id)===-1;}).length);
          renderPersonalArticles(arts.filter(function(a){return a.category==='personal';}));
          renderCatArticles('cat-rules',  arts.filter(function(a){return a.category==='rules';}));
          renderCatArticles('cat-cases',  arts.filter(function(a){return a.category==='cases';}));
          renderCatArticles('cat-general',arts.filter(function(a){return a.category==='general';}));
          renderCatArticles('cat-content',arts.filter(function(a){return a.category==='content';}));
        }
      }).catch(function(){});
  }

  function renderArticlesPreview(arts){
    var el=document.getElementById('articles-preview');if(!el)return;
    if(!arts.length){el.innerHTML='<div style="padding:20px;text-align:center;font-size:12px;color:var(--ink-faint);">記事はありません</div>';return;}
    el.innerHTML=arts.map(function(a){
      var d=a.published_at?new Date(a.published_at).toLocaleDateString('ja-JP'):'';
      var icon=THUMB_ICONS[a.category]||'📄';
      var isGold=a.category==='personal'||a.target_role==='signer';
      return '<div class="article-row" style="padding:10px 14px;cursor:pointer;" onclick="switchPanel(\'articles\')">'
        +'<div class="article-thumb'+(isGold?' gold':'')+'">'+icon+'</div>'
        +'<div class="article-info"><div class="article-title">'+esc(a.title)+'</div>'
        +'<div class="article-meta"><span>'+d+'</span></div></div></div>';
    }).join('');
  }

  function renderArticlesList(arts){
    var el=document.getElementById('articles-list');if(!el)return;
    if(!arts.length){el.innerHTML='<div style="padding:20px;text-align:center;font-size:12px;color:var(--ink-faint);">記事はありません</div>';return;}
    el.innerHTML=arts.map(function(a){
      var d=a.published_at?new Date(a.published_at).toLocaleDateString('ja-JP'):'';
      var cat=CAT_MAP[a.category]||a.category;
      var icon=THUMB_ICONS[a.category]||'📄';
      var isGold=a.category==='personal'||a.target_role==='signer';
      return '<div class="article-row" style="padding:10px 14px;">'
        +'<div class="article-thumb'+(isGold?' gold':'')+'">'+icon+'</div>'
        +'<div class="article-info"><div class="article-title">'+esc(a.title)+'</div>'
        +'<div class="article-meta"><span class="badge badge-gray">'+cat+'</span><span>'+d+'</span></div></div></div>';
    }).join('');
  }

  function loadReferral(){
    fetch(API+'/api/my-referral',{headers:{'Authorization':'Bearer '+token}})
      .then(function(r){return r.json();})
      .then(function(data){
        if(data.referral_url){set('referral-url-text',data.referral_url);set('referral-code-text',data.referral_code);}
      }).catch(function(){});
  }

  window.copyReferralUrl=function(){
    var el=document.getElementById('referral-url-text');if(!el)return;
    var url=el.textContent;
    var showMsg=function(){var m=document.getElementById('copy-msg');if(m){m.style.display='block';setTimeout(function(){m.style.display='none';},3000);}};
    if(navigator.clipboard){navigator.clipboard.writeText(url).then(showMsg).catch(function(){fallbackCopy(url);showMsg();});}
    else{fallbackCopy(url);showMsg();}
  };
  function fallbackCopy(text){var ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}

  function loadAdminData(){
    fetch(API+'/api/admin/members',{headers:{'Authorization':'Bearer '+token}})
      .then(function(r){return r.json();})
      .then(function(data){
        allMembers=data.members||[];
        renderAdminStats();renderPendingPreview();renderContractSignedPreview();renderPendingFull();renderMembersTable(allMembers);
      }).catch(function(){});
  }

  function renderAdminStats(){
    var tot=allMembers.filter(function(m){return m.role!=='admin';}).length;
    var pen=allMembers.filter(function(m){return m.status==='pending'||m.status==='approved'||m.status==='contract_signed';}).length;
    var act=allMembers.filter(function(m){return m.status==='active'&&m.role!=='admin';}).length;
    var rej=allMembers.filter(function(m){return m.status==='rejected';}).length;
    set('adm-stat-total',tot);set('adm-stat-pending',pen);set('adm-stat-active',act);
    set('mem-stat-total',tot);set('mem-stat-pending',pen);set('mem-stat-active',act);set('mem-stat-rejected',rej);
    var b=document.getElementById('pending-badge');if(b){b.textContent=pen;b.style.display=pen>0?'inline':'none';}
  }

  function renderContractSignedPreview(){
    var p=allMembers.filter(function(m){return m.status==='contract_signed';});
    var el=document.getElementById('contract-signed-preview');if(!el)return;
    if(!p.length){el.innerHTML='<div style="padding:10px;text-align:center;font-size:12px;color:var(--ink-faint);">発行待ちはありません</div>';return;}
    el.innerHTML=p.map(function(m){
      var ch=(m.full_name||'会').charAt(0);
      return '<div class="pending-row"><div class="avatar new" style="background:var(--gold);">'+ch+'</div>'
        +'<div class="pending-info"><div class="pending-name">'+esc(m.full_name||'—')+'</div>'
        +'<div class="pending-time">契約書同意済み・ログイン未発行</div></div>'
        +'<div class="pending-actions">'
        +'<button class="btn-approve" onclick="openIssueLogin(\''+m.id+'\',\''+esc(m.full_name||'')+'\')">発行</button>'
        +'</div></div>';
    }).join('');
  }

  function renderPendingPreview(){
    var p=allMembers.filter(function(m){return m.status==='pending';}).slice(0,3);
    var el=document.getElementById('pending-preview');if(!el)return;
    if(!p.length){el.innerHTML='<div style="padding:10px;text-align:center;font-size:12px;color:var(--ink-faint);">審査待ちはありません</div>';return;}
    el.innerHTML=p.map(function(m){
      var ch=(m.full_name||'会').charAt(0);
      var rf=allMembers.find(function(x){return x.id===m.referred_by;});
      return '<div class="pending-row"><div class="avatar new">'+ch+'</div>'
        +'<div class="pending-info"><div class="pending-name">'+esc(m.full_name||'—')+'</div>'
        +'<div class="pending-time">紹介者：'+esc(rf?rf.full_name||'—':'—')+'</div></div>'
        +'<div class="pending-actions">'
        +'<button class="btn-approve" onclick="openApprove(\''+m.id+'\',\''+esc(m.full_name||'')+'\')">承認</button>'
        +'<button class="btn-deny" onclick="openReject(\''+m.id+'\',\''+esc(m.full_name||'')+'\')">否認</button>'
        +'</div></div>';
    }).join('');
  }

  function renderPendingFull(){
    var p=allMembers.filter(function(m){return m.status==='pending';});
    var el=document.getElementById('pending-tbody-wrap');if(!el)return;
    if(!p.length){el.innerHTML='<div style="padding:20px;text-align:center;font-size:12px;color:var(--ink-faint);">審査待ちの申請はありません</div>';return;}
    el.innerHTML='<table class="data-table"><thead><tr><th>申請日</th><th>氏名</th><th>フリガナ</th><th>法人名</th><th>紹介者</th><th>操作</th></tr></thead><tbody>'
      +p.map(function(m){
        var reg=m.reg_date?new Date(m.reg_date).toLocaleDateString('ja-JP'):'—';
        var rf=allMembers.find(function(x){return x.id===m.referred_by;});
        return '<tr><td style="font-size:11px;color:var(--ink-faint);">'+reg+'</td>'
          +'<td style="font-weight:600;">'+esc(m.full_name||'—')+'</td>'
          +'<td style="font-size:11px;color:var(--ink-muted);">'+(m.kana_name||'—')+'</td>'
          +'<td style="font-size:11px;color:var(--ink-muted);">'+(m.corp_name||'—')+'</td>'
          +'<td style="font-size:11px;color:var(--ink-muted);">'+esc(rf?rf.full_name||'—':'—')+'</td>'
          +'<td><div style="display:flex;gap:5px;">'
          +'<button class="btn-sm btn-sm-red" onclick="openApprove(\''+m.id+'\',\''+esc(m.full_name||'')+'\')">承認</button>'
          +'<button class="btn-sm btn-sm-gray" onclick="openReject(\''+m.id+'\',\''+esc(m.full_name||'')+'\')">否認</button>'
          +'</div></td></tr>';
      }).join('')+'</tbody></table>';
  }

  function renderMembersTable(members){
    var f=members.filter(function(m){return m.role!=='admin';});
    var el=document.getElementById('members-tbody');if(!el)return;
    if(!f.length){el.innerHTML='<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--ink-faint);">会員がいません</td></tr>';return;}
    var rm={bronze:'ブロンズ',silver:'シルバー',gold:'ゴールド',platinum:'プラチナ'};
    el.innerHTML=f.map(function(m){
      var rl=m.role==='signer'?'サイナー':'バンカー';
      var sl=m.status==='active'?'有効':m.status==='pending'?'審査待ち':m.status==='approved'?'契約書未同意':m.status==='contract_signed'?'同意済み':'否認済み';
      var sc=m.status==='active'?'badge-green':m.status==='pending'?'badge-orange':m.status==='approved'?'badge-gray':m.status==='contract_signed'?'badge-blue':'badge-gray';
      var exp=m.expiry_date?new Date(m.expiry_date).toLocaleDateString('ja-JP'):'—';
      return '<tr><td><span class="mem-no">'+(m.member_no||'未発番')+'</span></td>'
        +'<td style="font-weight:600;">'+esc(m.full_name||'—')+'</td>'
        +'<td><span class="badge badge-red">'+rl+'</span></td>'
        +'<td style="font-size:11px;color:var(--ink-muted);">'+(rm[m.rank]||m.rank||'—')+'</td>'
        +'<td><span class="badge '+sc+'">'+sl+'</span></td>'
        +'<td style="font-size:11px;color:var(--ink-muted);">'+exp+'</td>'
        +'<td style="font-size:10px;color:var(--red);">'+(m.referral_code||'—')+'</td>'
        +'<td><div style="display:flex;gap:5px;">'
        +(m.status==='contract_signed'?'<button class="btn-sm btn-sm-red" onclick="openIssueLogin(\''+m.id+'\',\''+esc(m.full_name||'')+'\')">ログイン発行</button>':'')
        +'<button class="btn-sm btn-sm-blue" onclick="openEdit(\''+m.id+'\')">編集</button>'
        +'</div></td></tr>';
    }).join('');
  }

  window.searchMembers=function(q){
    renderMembersTable(q?allMembers.filter(function(m){
      return (m.full_name||'').toLowerCase().includes(q.toLowerCase())||(m.member_no||'').toLowerCase().includes(q.toLowerCase());
    }):allMembers);
  };

  function loadAdminArticles(){
    fetch(API+'/api/admin/articles',{headers:{'Authorization':'Bearer '+token}})
      .then(function(r){return r.json();})
      .then(function(data){
        allAdminArticles=data.articles||[];
        renderAdminArticles();renderArticlesAdminPreview();
        set('adm-stat-articles',allAdminArticles.filter(function(a){return a.status==='published';}).length);
      }).catch(function(){});
  }

  function renderArticlesAdminPreview(){
    var el=document.getElementById('articles-preview-admin');if(!el)return;
    var arts=allAdminArticles.slice(0,3),roleMap={all:'全員',banker:'バンカー',signer:'サイナー'};
    if(!arts.length){el.innerHTML='<div style="text-align:center;font-size:12px;color:var(--ink-faint);">記事がありません</div>';return;}
    el.innerHTML=arts.map(function(a){
      var d=a.published_at?new Date(a.published_at).toLocaleDateString('ja-JP'):(a.status==='draft'?'下書き':'—');
      return '<div class="article-row"><div class="article-thumb">'+(THUMB_ICONS[a.category]||'📄')+'</div>'
        +'<div class="article-info"><div class="article-title">'+esc(a.title)+'</div>'
        +'<div class="article-meta"><span>'+d+'</span><span class="badge badge-gray">'+(roleMap[a.target_role]||a.target_role)+'</span></div></div></div>';
    }).join('');
  }

  function renderAdminArticles(){
    var el=document.getElementById('articles-admin-tbody');if(!el)return;
    var roleMap={all:'全会員',banker:'バンカー',signer:'サイナー'};
    if(!allAdminArticles.length){el.innerHTML='<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--ink-faint);">記事がありません</td></tr>';return;}
    el.innerHTML=allAdminArticles.map(function(a){
      var d=a.published_at?new Date(a.published_at).toLocaleDateString('ja-JP'):'—';
      var cat=CAT_MAP[a.category]||a.category;
      return '<tr><td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(a.title)+'</td>'
        +'<td style="font-size:11px;"><span class="badge badge-gray">'+cat+'</span></td>'
        +'<td style="font-size:11px;color:var(--ink-muted);">'+(roleMap[a.target_role]||a.target_role)+'</td>'
        +'<td><span class="badge '+(a.status==='published'?'badge-pub':'badge-draft')+'">'+(a.status==='published'?'公開中':'下書き')+'</span></td>'
        +'<td style="font-size:11px;color:var(--ink-muted);">'+d+'</td>'
        +'<td><div style="display:flex;gap:5px;">'
        +'<button class="btn-sm btn-sm-blue" onclick="openArticleEdit(\''+a.id+'\')">編集</button>'
        +'<button class="btn-sm btn-sm-del" onclick="deleteArticle(\''+a.id+'\',\''+esc(a.title)+'\')">削除</button>'
        +'</div></td></tr>';
    }).join('');
  }

  window.openArticleForm=function(){window.location.href='/article-editor';};
  window.openArticleEdit=function(id){window.location.href='/article-editor?id='+id;};

  window.saveArticle=function(){
    var id=((document.getElementById('article-edit-id')||{}).value||'');
    var title=((document.getElementById('article-title')||{}).value||'').trim();
    var body=((document.getElementById('article-body')||{}).value||'').trim();
    var msgEl=document.getElementById('article-msg');
    if(!title||!body){if(msgEl){msgEl.className='msg-error';msgEl.textContent='タイトルと本文は必須です。';msgEl.style.display='block';}return;}
    var payload={title:title,body:body,category:(document.getElementById('article-category')||{}).value,
      target_role:(document.getElementById('article-target-role')||{}).value,
      status:(document.getElementById('article-status')||{}).value,
      min_rank:(document.getElementById('article-min-rank')||{}).value};
    fetch(id?API+'/api/admin/articles/'+id:API+'/api/admin/articles',
      {method:id?'PUT':'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){return r.json();})
      .then(function(d){
        if(d.article){
          if(msgEl){msgEl.className='msg-success';msgEl.textContent='保存しました！';msgEl.style.display='block';}
          loadAdminArticles();loadArticles();
          setTimeout(function(){switchPanel('article-mgmt');},800);
        } else {if(msgEl){msgEl.className='msg-error';msgEl.textContent='エラー：'+(d.error||'不明なエラー');msgEl.style.display='block';}}
      });
  };

  window.deleteArticle=function(id,title){
    if(!confirm('「'+title+'」を削除しますか？'))return;
    fetch(API+'/api/admin/articles/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+token}})
      .then(function(r){return r.json();}).then(function(d){if(d.message){loadAdminArticles();loadArticles();}});
  };

  function showModal(title,body,confirmFn){
    var ex=document.getElementById('qx-modal');if(ex)ex.remove();
    var el=document.createElement('div');el.id='qx-modal';
    el.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    el.innerHTML='<div style="background:white;border-radius:6px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2);">'
      +'<div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;">'
      +'<span style="font-size:14px;font-weight:700;">'+title+'</span>'
      +'<button onclick="closeModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--ink-muted);line-height:1;">×</button></div>'
      +'<div style="padding:20px;">'+body+'</div>'
      +'<div style="padding:14px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">'
      +'<button onclick="closeModal()" style="padding:8px 16px;font-size:12px;border:1px solid var(--border);border-radius:3px;cursor:pointer;background:white;font-family:var(--font);">キャンセル</button>'
      +'<button onclick="runModalConfirm()" style="padding:8px 20px;font-size:12px;font-weight:700;background:var(--red);color:white;border:none;border-radius:3px;cursor:pointer;font-family:var(--font);">実行</button>'
      +'</div></div>';
    document.body.appendChild(el);window._modalConfirmFn=confirmFn;
  }
  window.closeModal=function(){var m=document.getElementById('qx-modal');if(m)m.remove();};
  window.runModalConfirm=function(){if(window._modalConfirmFn)window._modalConfirmFn();};

  window.openApprove=function(id,name){
    var ed=new Date();ed.setFullYear(ed.getFullYear()+1);
    showModal('会員申請を承認する',
      '<div style="padding:12px;background:var(--red-light);border:1px solid rgba(169,27,13,.2);border-radius:3px;margin-bottom:14px;font-size:12px;color:var(--red);">'+name+' 様の申請を承認します</div>'
      +'<div style="margin-bottom:12px;"><label style="display:block;font-size:10px;font-weight:600;color:var(--ink-muted);margin-bottom:4px;">アカウント種別</label><select id="m-role" style="width:100%;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:3px;font-family:var(--font);"><option value="banker">バンカー</option><option value="signer">サイナー</option></select></div>'
      +'<div style="margin-bottom:12px;"><label style="display:block;font-size:10px;font-weight:600;color:var(--ink-muted);margin-bottom:4px;">ランク</label><select id="m-rank" style="width:100%;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:3px;font-family:var(--font);"><option value="bronze">ブロンズ</option><option value="silver">シルバー</option><option value="gold">ゴールド</option><option value="platinum">プラチナ</option></select></div>'
      +'<div><label style="display:block;font-size:10px;font-weight:600;color:var(--ink-muted);margin-bottom:4px;">有効期限</label><input id="m-expiry" type="date" value="'+ed.toISOString().split('T')[0]+'" style="width:100%;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:3px;font-family:var(--font);"></div>',
      function(){
        fetch(API+'/api/admin/members/approve',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
          body:JSON.stringify({user_id:id,role:(document.getElementById('m-role')||{}).value,expiry_date:(document.getElementById('m-expiry')||{}).value})})
          .then(function(r){return r.json();})
          .then(function(d){closeModal();if(d.message){alert('承認しました。');loadAdminData();}else alert('エラー：'+(d.error||'不明'));});
      });
  };

  window.openReject=function(id,name){
    showModal('申請を否認する',
      '<div style="padding:12px;background:var(--red-light);border:1px solid rgba(169,27,13,.2);border-radius:3px;margin-bottom:14px;font-size:12px;color:var(--red);">'+name+' 様の申請を否認します</div>'
      +'<p style="font-size:12px;color:var(--ink-muted);">否認するとメールで通知されます。この操作は取り消せません。</p>',
      function(){
        fetch(API+'/api/admin/members/reject',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({user_id:id})})
          .then(function(r){return r.json();})
          .then(function(d){closeModal();if(d.message){alert('否認しました。');loadAdminData();}else alert('エラー：'+(d.error||'不明'));});
      });
  };

  window.openIssueLogin=function(id,name){
    showModal('ログイン情報を発行する',
      '<div style="padding:12px;background:var(--red-light);border:1px solid rgba(169,27,13,.2);border-radius:3px;margin-bottom:14px;font-size:12px;color:var(--red);">'+name+' 様にログイン情報を発行します</div>'
      +'<p style="font-size:12px;color:var(--ink-muted);">ログインIDとパスワードをメールで送信します。ステータスが「有効」に変更されます。</p>',
      function(){
        fetch(API+'/api/admin/members/issue',{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({user_id:id})})
          .then(function(r){return r.json();})
          .then(function(d){closeModal();if(d.message){alert('ログイン情報を発行しました。');loadAdminData();}else alert('エラー：'+(d.error||'不明'));});
      });
  };

  window.openEdit=function(id){
    var m=allMembers.find(function(x){return x.id===id;});if(!m)return;
    var exp=m.expiry_date?m.expiry_date.split('T')[0]:'';
    showModal('会員情報を編集',
      '<div style="margin-bottom:12px;"><label style="display:block;font-size:10px;font-weight:600;color:var(--ink-muted);margin-bottom:4px;">氏名</label><input id="e-name" type="text" value="'+esc(m.full_name||'')+'" style="width:100%;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:3px;font-family:var(--font);"></div>'
      +'<div style="margin-bottom:12px;"><label style="display:block;font-size:10px;font-weight:600;color:var(--ink-muted);margin-bottom:4px;">種別</label><select id="e-role" style="width:100%;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:3px;font-family:var(--font);"><option value="banker"'+(m.role==='banker'?' selected':'')+'>バンカー</option><option value="signer"'+(m.role==='signer'?' selected':'')+'>サイナー</option></select></div>'
      +'<div style="margin-bottom:12px;"><label style="display:block;font-size:10px;font-weight:600;color:var(--ink-muted);margin-bottom:4px;">ランク</label><select id="e-rank" style="width:100%;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:3px;font-family:var(--font);"><option value="bronze"'+(m.rank==='bronze'?' selected':'')+'>ブロンズ</option><option value="silver"'+(m.rank==='silver'?' selected':'')+'>シルバー</option><option value="gold"'+(m.rank==='gold'?' selected':'')+'>ゴールド</option><option value="platinum"'+(m.rank==='platinum'?' selected':'')+'>プラチナ</option></select></div>'
      +'<div style="margin-bottom:12px;"><label style="display:block;font-size:10px;font-weight:600;color:var(--ink-muted);margin-bottom:4px;">ステータス</label><select id="e-status" style="width:100%;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:3px;font-family:var(--font);"><option value="active"'+(m.status==='active'?' selected':'')+'>有効</option><option value="pending"'+(m.status==='pending'?' selected':'')+'>審査待ち</option><option value="rejected"'+(m.status==='rejected'?' selected':'')+'>否認済み</option></select></div>'
      +'<div><label style="display:block;font-size:10px;font-weight:600;color:var(--ink-muted);margin-bottom:4px;">有効期限</label><input id="e-expiry" type="date" value="'+exp+'" style="width:100%;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:3px;font-family:var(--font);"></div>',
      function(){
        fetch(API+'/api/admin/members/'+id,{method:'PUT',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
          body:JSON.stringify({full_name:(document.getElementById('e-name')||{}).value,role:(document.getElementById('e-role')||{}).value,
            rank:(document.getElementById('e-rank')||{}).value,status:(document.getElementById('e-status')||{}).value,
            expiry_date:(document.getElementById('e-expiry')||{}).value||null})})
          .then(function(r){return r.json();})
          .then(function(d){closeModal();if(d.member){loadAdminData();}else alert('エラー：'+(d.error||'不明'));});
      });
  };

  var PANELS=['overview','articles','profile','referral','members','article-mgmt','article-form','notifications'];
  window.switchPanel=function(name){
    PANELS.forEach(function(p){
      var el=document.getElementById('panel-'+p);if(el)el.classList.toggle('active',p===name);
    });
    var titles={overview:'ダッシュボード',articles:isAdmin?'ブログ・記事管理':'記事一覧',
      profile:'会員情報',referral:'紹介URL',members:'会員管理','article-mgmt':'記事管理',
      'article-form':(document.getElementById('article-form-heading')||{}).textContent||'記事作成',
      notifications:'お知らせ'};
    set('topbar-title',titles[name]||name);
    PANELS.forEach(function(p){
      var nb=document.getElementById('nav-btn-'+p);if(nb)nb.classList.toggle('active',p===name);
      var tb=document.getElementById('tab-'+p);if(tb)tb.classList.toggle('active',p===name);
    });
    currentPanel=name;
    window.scrollTo(0,0);
  };

  window.doLogout=function(){
    localStorage.removeItem('qxiv_token');localStorage.removeItem('qxiv_refresh');localStorage.removeItem('qxiv_user');
    window.location.href='/login';
  };

  function loadDashRanking(){
    var ym=new Date().toISOString().slice(0,7);
    fetch(API+'/api/ranking/my?ym='+ym,{headers:{'Authorization':'Bearer '+token}})
      .then(function(r){return r.json();})
      .then(function(data){set('dash-my-rank-stat',data.rank?'#'+data.rank:'—');}).catch(function(){});
    fetch(API+'/api/ranking?ym='+ym,{headers:{'Authorization':'Bearer '+token}})
      .then(function(r){return r.json();})
      .then(function(data){renderRankingTop5(data.ranking||[]);}).catch(function(){});
  }

  function renderRankingTop5(list){
    var el=document.getElementById('dash-ranking-top5');if(!el)return;
    var medals=['🥇','🥈','🥉'];
    if(!list.length){el.innerHTML='<div style="padding:16px;text-align:center;font-size:12px;color:var(--ink-faint);">今月のデータがありません</div>';return;}
    el.innerHTML=list.slice(0,5).map(function(r,i){
      var pf=r.profiles||{};
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">'
        +'<div style="width:24px;text-align:center;font-size:'+(i<3?'16':'12')+'px;font-weight:700;color:var(--ink-faint);">'+(i<3?medals[i]:i+1)+'</div>'
        +'<div style="flex:1;font-size:11px;color:var(--red);font-weight:700;">'+(pf.member_no||'—')+'</div>'
        +'<div style="font-size:13px;font-weight:900;color:var(--ink);font-variant-numeric:tabular-nums;">'+formatNum(r.amount)+'<span style="font-size:10px;color:var(--ink-muted);margin-left:2px;">円</span></div>'
        +'</div>';
    }).join('');
  }

  function loadAdminRanking(){
    var ym=new Date().toISOString().slice(0,7);
    fetch(API+'/api/ranking?ym='+ym,{headers:{'Authorization':'Bearer '+token}})
      .then(function(r){return r.json();})
      .then(function(data){renderAdminDashRanking(data.ranking||[]);}).catch(function(){});
  }

  function renderAdminDashRanking(list){
    var el=document.getElementById('admin-dash-ranking');if(!el)return;
    var medals=['🥇','🥈','🥉'];
    if(!list.length){el.innerHTML='<div style="padding:20px;text-align:center;font-size:12px;color:var(--ink-faint);">今月のデータがありません。<a href="/ranking" style="color:var(--red);">ランキングページ</a>から入力してください。</div>';return;}
    el.innerHTML=list.slice(0,3).map(function(r,i){
      var pf=r.profiles||{};
      return '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);">'
        +'<div style="font-size:20px;flex-shrink:0;">'+medals[i]+'</div>'
        +'<div style="flex:1;min-width:0;"><div style="font-size:11px;font-weight:700;color:var(--red);">'+(pf.member_no||'—')+'</div>'
        +'<div style="font-size:13px;font-weight:600;color:var(--ink);">'+esc(pf.full_name||'—')+'</div></div>'
        +'<div style="font-size:16px;font-weight:900;color:var(--ink);font-variant-numeric:tabular-nums;">'+formatNum(r.amount)+'<span style="font-size:10px;color:var(--ink-muted);margin-left:2px;">円</span></div>'
        +'</div>';
    }).join('')+'<div style="padding:10px 14px;text-align:center;"><a href="/ranking" style="font-size:11px;color:var(--red);font-weight:600;text-decoration:none;">ランキング編集 →</a></div>';
  }

  function loadBankerContent(){
    fetch(API+'/api/contents',{headers:{'Authorization':'Bearer '+token}})
      .then(function(r){return r.json();})
      .then(function(data){
        var contents=data.contents||[],progress=data.progress||{};
        var done=contents.filter(function(c){return progress[c.id]&&progress[c.id].completed;}).length;
        var total=contents.length,pct=total?Math.round(done/total*100):0;
        var circle=document.getElementById('dp-circle');
        if(circle)circle.setAttribute('stroke-dasharray',(pct/100*100.5)+' 100.5');
        set('dash-prog-pct',pct+'%');set('dash-prog-sub',done+' / '+total+' 完了');
      }).catch(function(){});
  }

  function renderPersonalArticles(arts){
    var el=document.getElementById('dash-personal');if(!el)return;
    if(!arts.length){el.innerHTML='<div style="padding:16px;text-align:center;font-size:12px;color:var(--ink-faint);">専用記事はありません</div>';return;}
    el.innerHTML=arts.slice(0,3).map(function(a){
      var d=a.published_at?new Date(a.published_at).toLocaleDateString('ja-JP'):'';
      return '<div class="article-row" style="padding:8px 0;cursor:pointer;" onclick="window.location.href=\'/article?id='+a.id+'\'">'+'<div class="article-thumb gold">⭐</div>'
        +'<div class="article-info"><div class="article-title">'+esc(a.title)+'</div>'
        +'<div class="article-meta">'+d+'</div></div></div>';
    }).join('');
  }

  function renderCatArticles(id,arts){
    var el=document.getElementById(id);if(!el)return;
    if(!arts.length){el.innerHTML='<div style="padding:10px;font-size:12px;color:var(--ink-faint);text-align:center;">記事がありません</div>';return;}
    el.innerHTML=arts.slice(0,3).map(function(a){
      var d=a.published_at?new Date(a.published_at).toLocaleDateString('ja-JP'):'';
      return '<div class="article-row" style="padding:8px 0;cursor:pointer;" onclick="window.location.href=\'/article?id='+a.id+'\'"><div class="article-thumb">📄</div>'
        +'<div class="article-info"><div class="article-title">'+esc(a.title)+'</div>'
        +'<div class="article-meta">'+d+'</div></div></div>';
    }).join('');
  }

  function formatNum(n){return Number(n||0).toLocaleString('ja-JP');}
  function esc(s){return String(s||'').replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  switchPanel('overview');
})();
