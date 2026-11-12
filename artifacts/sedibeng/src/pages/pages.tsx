import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Form } from '@/components/ui/form';
import {
  useGetRequests, useGetRequest, getGetRequestQueryKey, getGetRequestsQueryKey,
  useGetAuthSession, getListSchoolsQueryKey, useRegisterDonor, useRegisterTeacher,
  useLogin, useRequestPasswordReset, useResetPassword, useVerifyEmail, useResendVerificationEmail,
  useLogout, useGetDonorDashboard, getGetDonorDashboardQueryKey, useGetTeacherDashboard, getGetTeacherDashboardQueryKey, useGetAdminDashboard, getGetAdminDashboardQueryKey,
  useGetInventory, getGetInventoryQueryKey, useCreateInventory, useUpdateInventory, useDeleteInventory,
  useGetSponsorships, getGetSponsorshipsQueryKey, useCreateSponsorship, useDecideSponsorship,
  useGetOrders, getGetOrdersQueryKey, useUpdateOrderStatus,
  useGetNotifications, getGetNotificationsQueryKey, useMarkNotificationRead,
  useGetMyVerification, getGetMyVerificationQueryKey, useSubmitVerification,
  useGetTeacherProfile, useListSchools,
  useCreateRequest, useUpdateRequest, useDeleteRequest,
  useListAdminUsers, getListAdminUsersQueryKey, useAdminUpdateUserStatus,
  useListVerificationQueue, getListVerificationQueueQueryKey, useDecideVerification,
  useListAdminReports, getListAdminReportsQueryKey, useDecideReport, useModerateRequest,
  useGetMyReports, getGetMyReportsQueryKey, useCreateReport,
} from '@workspace/api-client-react';
import type { AssistanceRequest, InventoryInput, InventoryItem, RequestInput } from '@workspace/api-client-react';
import { ArrowRight, ArrowUpRight, BookOpen, HeartHandshake, Search, ShieldCheck, LogOut, Package, Plus } from 'lucide-react';
import { DemoTag, ErrorState, LoadingState, PhotoImage, PrivacyNote } from '../components/site';

const heroPhoto = '/images/sedibeng-community-preparation.jpg';
const itemPhoto = '/images/sedibeng-stationery-kit.jpg';
const emptyValues = { name:'',email:'',password:'',schoolId:'',schoolName:'',district:'',area:'',token:'',newPassword:'',confirmPassword:'',note:'' };
type AuthKind = 'signin'|'donor'|'teacher'|'forgot'|'reset'|'verify';
type AuthValues = typeof emptyValues;
const authSchema = (kind: AuthKind) => z.object({
  name:z.string().optional(), email:z.string().email('Enter a valid email address').optional().or(z.literal('')),
  password:z.string().optional(),schoolId:z.string().optional(),schoolName:z.string().optional(),district:z.string().optional(),area:z.string().optional(),
  token:z.string().optional(),newPassword:z.string().optional(),confirmPassword:z.string().optional(),note:z.string().optional(),
}).superRefine((v,c)=>{
  const required:Record<AuthKind,string[]>={signin:['email','password'],donor:['name','email','password'],teacher:['name','email','password'],forgot:['email'],reset:['token','newPassword','confirmPassword'],verify:['token']};
  required[kind].forEach((k)=>{if(!v[k as keyof AuthValues]?.trim()) c.addIssue({code:'custom',path:[k],message:'This field is required.'})});
  if(kind==='teacher'){ if(!v.schoolId) c.addIssue({code:'custom',path:['schoolId'],message:'Please choose your school.'}); else if(v.schoolId==='OTHER'){ if(!v.schoolName?.trim()) c.addIssue({code:'custom',path:['schoolName'],message:'This field is required.'}); if(!v.district?.trim()) c.addIssue({code:'custom',path:['district'],message:'This field is required.'}) } }
  if(['signin','donor','teacher'].includes(kind) && v.password && v.password.length<12)c.addIssue({code:'custom',path:['password'],message:'Use at least 12 characters.'});
  if(kind==='reset' && v.newPassword && v.newPassword.length<12)c.addIssue({code:'custom',path:['newPassword'],message:'Use at least 12 characters.'});
  if(kind==='reset' && v.confirmPassword!==v.newPassword)c.addIssue({code:'custom',path:['confirmPassword'],message:'Passwords do not match.'});
});

const fieldTitles:Record<string,string>={name:'Full name',email:'Email address',password:'Password',schoolId:'Your school',schoolName:'School name',district:'District',area:'Area (optional)',token:'Verification or reset token',newPassword:'New password',confirmPassword:'Confirm password'};
const textInputType=(name:string)=>name.toLowerCase().includes('password')?'password':name==='email'?'email':'text';
const authMeta:Record<AuthKind,{title:string;copy:string;submit:string}>={
  signin:{title:'Welcome back.',copy:'Sign in to continue your work with Sedibeng.',submit:'Sign in'},
  donor:{title:'Give something useful.',copy:'Create a donor account to offer physical school goods.',submit:'Create donor account'},
  teacher:{title:'Start with the school need.',copy:'Create a teacher account to share school-level requests.',submit:'Create teacher account'},
  forgot:{title:'A fresh start.',copy:'We’ll send password reset instructions if an account is registered.',submit:'Send reset instructions'},
  reset:{title:'Choose a new password.',copy:'Use the secure reset token from your email.',submit:'Update password'},
  verify:{title:'Verify your email.',copy:'Paste the secure verification token from your email.',submit:'Verify email'},
};
export function AuthPage({kind}:{kind:AuthKind}) {
  const [,navigate]=useLocation(); const client=useQueryClient(); const [status,setStatus]=useState(''); const [failure,setFailure]=useState('');
  const handledToken=useRef('');
  const form=useForm<AuthValues>({resolver:zodResolver(authSchema(kind)),defaultValues:emptyValues});
  const registerDonor=useRegisterDonor(); const registerTeacher=useRegisterTeacher(); const login=useLogin(); const forgot=useRequestPasswordReset(); const reset=useResetPassword(); const verify=useVerifyEmail(); const resend=useResendVerificationEmail();
  const schools=useListSchools({},{query:{enabled:kind==='teacher',queryKey:getListSchoolsQueryKey({})}}); const chosenSchool=form.watch('schoolId');
  const busy=registerDonor.isPending||registerTeacher.isPending||login.isPending||forgot.isPending||reset.isPending||verify.isPending||resend.isPending;
  const submit=(v:AuthValues)=>{
    setFailure('');setStatus('');
    const done=(message:string,go?:string)=>{void client.invalidateQueries();setStatus(message);if(go)navigate(go)};
    const fail=(e:unknown)=>setFailure(e instanceof Error?e.message:'Something went wrong. Please try again.');
    if(kind==='signin') login.mutate({data:{email:v.email!,password:v.password!}},{onSuccess:(result)=>done('You’re signed in.',result.user?.role==='ADMIN'?'/admin':result.user?.role==='TEACHER'?'/teacher':result.user?.role==='DONOR'?'/donor':'/'),onError:fail});
    if(kind==='donor') registerDonor.mutate({data:{name:v.name!,email:v.email!,password:v.password!}},{onSuccess:()=>done('Account created. Check your inbox to verify your email.'),onError:fail});
    if(kind==='teacher') registerTeacher.mutate({data:v.schoolId&&v.schoolId!=='OTHER'?{name:v.name!,email:v.email!,password:v.password!,schoolId:v.schoolId}:{name:v.name!,email:v.email!,password:v.password!,schoolName:v.schoolName!,district:v.district!,area:v.area||undefined}},{onSuccess:()=>done('Account created. Check your inbox to verify your email.'),onError:fail});
    if(kind==='forgot') forgot.mutate({data:{email:v.email!}},{onSuccess:()=>done('If the address is registered, reset instructions are on their way.'),onError:fail});
    if(kind==='reset') reset.mutate({data:{token:v.token!,newPassword:v.newPassword!}},{onSuccess:()=>done('Password updated. You can now sign in.','/sign-in'),onError:fail});
    if(kind==='verify') verify.mutate({data:{token:v.token!}},{onSuccess:()=>done('Email verified.','/sign-in'),onError:fail});
  };
  const queryToken=useMemo(()=>new URLSearchParams(window.location.search).get('token')||'',[kind]);
  useEffect(()=>{
    if((kind==='reset'||kind==='verify')&&queryToken)form.setValue('token',queryToken,{shouldValidate:true});
    if(kind!=='verify'||!queryToken||handledToken.current===queryToken)return;
    handledToken.current=queryToken;
    setFailure('');
    verify.mutate({data:{token:queryToken}},{onSuccess:()=>setStatus('Email verified. You can now sign in.'),onError:e=>setFailure(e instanceof Error?e.message:'This verification link could not be used.')});
  },[kind,queryToken,form,verify]);
  const meta=authMeta[kind];
  return <main className="auth-page"><section className="auth-art"><PhotoImage src={heroPhoto} alt="A classroom prepared with learning materials"/><div className="auth-art-shade"/><div className="auth-art-copy"><span className="eyebrow">Sedibeng · Botswana</span><h2>Care, made practical.</h2><p>Physical school essentials, offered with dignity and care.</p></div></section>
    <section className="auth-form-wrap"><div className="auth-card"><span className="eyebrow">Your Sedibeng account</span><h1 data-testid="text-auth-title">{meta.title}</h1><p>{meta.copy}</p>
      <Form {...form}><form onSubmit={form.handleSubmit(submit)} data-testid={`form-auth-${kind}`}>
      {(kind==='signin'?['email','password']:kind==='donor'?['name','email','password']:kind==='teacher'?['name','email','schoolId','schoolName','district','area','password']:kind==='forgot'?['email']:kind==='reset'?['token','newPassword','confirmPassword']:['token']).map(name=>{ if(kind==='teacher'&&name==='schoolId') return <label className="field" key={name}>{fieldTitles[name]}<span className="required-mark"> *</span><select className="auth-input" {...form.register('schoolId')} data-testid="select-auth-school"><option value="">Choose your school</option>{(schools.data??[]).map(sc=><option key={sc.id} value={sc.id}>{sc.name} · {sc.district}</option>)}<option value="OTHER">My school isn’t listed</option></select><small className="field-error">{form.formState.errors.schoolId?.message as string}</small></label>; if(kind==='teacher'&&['schoolName','district','area'].includes(name)&&chosenSchool!=='OTHER') return null; return <label className="field" key={name}>{fieldTitles[name]}{['schoolName','district','area'].includes(name)&&kind==='teacher'&&<span className="required-mark">{name!=='area'?' *':''}</span>}<input className="auth-input" type={textInputType(name)} autoComplete={name==='email'?'email':kind==='signin'&&name==='password'?'current-password':name.toLowerCase().includes('password')?'new-password':'off'} {...form.register(name as keyof AuthValues)} data-testid={`input-auth-${name}`}/><small className="field-error">{form.formState.errors[name as keyof AuthValues]?.message as string}</small></label>})}
      {kind==='signin'&&<div className="auth-links"><Link href="/forgot-password" data-testid="link-forgot-password">Forgot password?</Link><Link href="/verify-email" data-testid="link-verify-email">Verify email</Link></div>}
      {failure&&<div className="alert alert-error" role="alert" data-testid="state-auth-error">{failure}</div>}
      {status&&<div className="alert alert-success" role="status" data-testid="state-auth-success">{status}</div>}
      <button className="button button-primary full-button" type="submit" disabled={busy} data-testid="button-auth-submit">{busy?'Working…':meta.submit}<ArrowRight size={16}/></button>
      </form></Form>
      {kind==='signin'&&<button type="button" className="text-button" disabled={busy} onClick={()=>{const email=form.getValues('email');if(!email){setFailure('Enter your email address first.');return}resend.mutate({data:{email}},{onSuccess:()=>setStatus('Verification email sent. Check your inbox.'),onError:e=>setFailure(e instanceof Error?e.message:'Could not resend the message.')})}} data-testid="button-resend-verification">Resend verification email</button>}
      <div className="auth-foot">{kind==='signin'?<>New to Sedibeng? <Link href="/register/donor">Join as a donor</Link> · <Link href="/register/teacher">Join as a teacher</Link></>:<>Already have an account? <Link href="/sign-in">Sign in</Link></>}</div>
    </div></section></main>;
}

export function HomePage(){
  const requests=useGetRequests({});const session=useGetAuthSession();
  return <main><section className="hero"><div className="hero-copy-block"><span className="eyebrow">School essentials, shared with care</span><h1>A little help.<br/><em>A fuller desk.</em></h1><p>Sedibeng brings teachers’ requests for physical school goods together with people ready to help—quietly, thoughtfully, with learners’ dignity at the centre.</p><div className="hero-actions"><Link href="/requests" className="button button-primary" data-testid="link-explore-requests">Browse school needs <ArrowUpRight size={16}/></Link><Link href={session.data?.user?.role==='TEACHER'?'/teacher':'/register/teacher'} className="button button-outline" data-testid="link-teacher-start">{session.data?.user?.role==='TEACHER'?'Teacher workspace':'I’m a teacher'}</Link></div><div className="hero-note"><span/>Physical goods only <span/>No money transfers <span/>Learners stay private</div></div><div className="hero-visual"><PhotoImage className="hero-image" src={heroPhoto} alt="Sunlit empty classroom with school supplies arranged on desks" data-testid="img-home-hero"/><div className="hero-stamp">For the<br/>next school<br/>day</div><div className="image-caption">Practical support, close to what schools need.</div></div></section>
    <section className="section"><div className="section-inner"><div className="section-heading"><div><span className="eyebrow">A careful exchange</span><h2>Support that stays close to what a school needs.</h2></div><p>Teachers describe school-level needs. Donors offer useful physical goods. Every step keeps learner privacy in view.</p></div><div className="steps"><article className="step"><span className="step-no">01 / TEACHERS</span><h3>Share the school need</h3><p>Describe items, quantities and school context without disclosing a learner’s identity.</p></article><article className="step"><span className="step-no">02 / DONORS</span><h3>Choose goods to give</h3><p>Browse published needs or list available goods. No money changes hands on Sedibeng.</p></article><article className="step"><span className="step-no">03 / WITH CARE</span><h3>Keep dignity in view</h3><p>Teacher-led decisions and school-level details keep support appropriate and private.</p></article></div></div></section>
    <section className="story-band"><div className="story-content"><div><span className="eyebrow">The principle behind the platform</span><h2>Help should feel human.<br/>Privacy should feel certain.</h2><p>Sedibeng is built around educators and school-level needs. The public catalogue keeps personal details out of view, while giving stays tangible.</p></div><div className="story-quote">“Sedibeng go iwa ka tsela”<br/><small>The Sedibeng way of giving</small></div></div></section>
    <section className="section"><div className="section-inner"><div className="section-heading"><div><span className="eyebrow">Published school needs</span><h2>One useful thing can make a difference.</h2></div><p>Browse real published requests and choose a practical way to help.</p></div>{requests.isLoading?<LoadingState label="Loading published requests"/>:requests.isError?<ErrorState onRetry={()=>void requests.refetch()}/>:<div className="request-grid">{(requests.data??[]).slice(0,3).map((r,i)=><RequestCard item={r} key={r.id} index={i}/>)}</div>}<Link href="/requests" className="text-link featured-link">Explore all requests <ArrowRight size={14}/></Link></div></section>
    <section className="section"><div className="section-inner split-feature"><PhotoImage src={itemPhoto} alt="Notebooks, pencils and school essentials arranged on a table"/><div><span className="eyebrow">Safeguarding comes first</span><h2>Support the need.<br/>Protect the learner.</h2><p>Learners do not need accounts. Requests show school context only, never learner names, faces or private circumstances.</p><PrivacyNote/><div className="hero-actions"><Link href="/register/donor" className="button button-primary">Give physical goods <ArrowRight size={15}/></Link><Link href="/register/teacher" className="text-link">Share a school need <ArrowRight size={14}/></Link></div></div></div></section>
    <section className="close-cta"><div className="close-cta-inner"><div><span className="eyebrow">Small essentials. Real care.</span><h2>Find a school need you can help meet.</h2></div><Link href="/requests" className="button button-primary">Browse requests <ArrowUpRight size={16}/></Link></div></section></main>;
}

function RequestCard({item,index}:{item:AssistanceRequest;index:number}){
  return <article className="request-card" data-testid={`card-request-${item.id}`}><Link href={`/requests/${item.id}`}><div className="request-image-wrap"><PhotoImage src={item.imageUrl||itemPhoto} alt={item.imageAlt||'School supplies'} className="request-image" loading={index<3?'eager':'lazy'}/><span className="image-pill">{item.category}</span>{item.isSeedData&&<span className="image-pill request-status-pill">Development sample</span>}</div></Link><div className="request-content"><div className="request-meta"><span>{item.location}</span><span>{item.priority}</span></div><h3>{item.title}</h3><p>{item.description}</p><div className="request-footer"><span className="qty">{item.quantity} {item.unit}</span><Link className="text-link" href={`/requests/${item.id}`} data-testid={`link-request-${item.id}`}>View request <ArrowUpRight size={14}/></Link></div></div></article>
}

export function RequestsPage(){
  const [search,setSearch]=useState('');const [category,setCategory]=useState('');const [priority,setPriority]=useState('');
  const params=useMemo(()=>({search:search||undefined,category:category||undefined,priority:priority||undefined}),[search,category,priority]);
  const q=useGetRequests(params);
  return <main><div className="page-head"><span className="eyebrow">The school essentials catalogue</span><h1>Requests, with care.</h1><p>Published school needs for physical goods. Personal learner details are never included.</p></div><section className="catalog-wrap"><div className="catalog-toolbar"><label className="searchbox"><Search size={16}/><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search items, schools or categories" aria-label="Search requests" data-testid="input-request-search"/></label><select className="select-control" value={category} onChange={e=>setCategory(e.target.value)} aria-label="Filter category" data-testid="select-request-category"><option value="">All categories</option><option>School shoes</option><option>Books & stationery</option><option>Bags</option><option>Uniforms</option></select><select className="select-control" value={priority} onChange={e=>setPriority(e.target.value)} aria-label="Filter priority" data-testid="select-request-priority"><option value="">Any priority</option><option>Essential</option><option>High</option><option>Standard</option></select></div>
    {q.isLoading?<LoadingState label="Loading published requests"/>:q.isError?<ErrorState onRetry={()=>void q.refetch()}/>:q.data?.length?<><p className="result-line">{q.data.length} published {q.data.length===1?'request':'requests'}{q.data.some(x=>x.isSeedData)?' · includes development sample data':''}</p><div className="request-grid">{q.data.map((r,i)=><RequestCard item={r} index={i} key={r.id}/>)}</div></>:<div className="state-panel"><BookOpen size={25}/><h3>No requests found</h3><p>Try another search or clear the filters.</p><button className="button button-outline" onClick={()=>{setSearch('');setCategory('');setPriority('')}} data-testid="button-clear-filters">Clear filters</button></div>}</section></main>;
}

export function RequestDetailPage({backHref='/requests',backLabel='Back to requests'}:{backHref?:string;backLabel?:string}={}){
 const {id}=useParams<{id:string}>();const q=useGetRequest(id||'',{query:{enabled:!!id,queryKey:getGetRequestQueryKey(id||'')}});const session=useGetAuthSession();const makeOffer=useCreateSponsorship();const createReport=useCreateReport();const client=useQueryClient();const [message,setMessage]=useState('');const [error,setError]=useState('');const [showReport,setShowReport]=useState(false);
 const offerForm=useForm<{quantity:number;donorMessage:string}>({defaultValues:{quantity:1,donorMessage:''}});
 const reportForm=useForm<{reason:string;details:string}>({defaultValues:{reason:'',details:''}});
 if(q.isLoading)return <div className="page-head"><LoadingState label="Loading request"/></div>;if(q.isError||!q.data)return <div className="page-head"><ErrorState onRetry={()=>void q.refetch()}/></div>;
 const r=q.data;
 return <main><div className="page-head detail-back"><Link href={backHref} className="text-link"><ArrowRight className="back-arrow" size={14}/>{backLabel}</Link></div><div className="detail-layout"><section className="detail-main"><PhotoImage className="detail-photo" src={r.imageUrl||itemPhoto} alt={r.imageAlt||'School goods'} data-testid="img-request-detail"/><div className="detail-tags"><span className="image-pill static-pill">{r.category}</span>{r.isSeedData&&<DemoTag label="Development sample data"/>}</div><p className="detail-context"><span className="eyebrow">School-level context</span>{r.schoolContext}</p><h1>{r.title}</h1><p>{r.description}</p><h3>What would be useful</h3><p>{r.specifications||r.item}</p><PrivacyNote/></section>
 <aside className="detail-box"><h3>Request overview</h3>{[['Item',r.item],['Quantity',`${r.quantity} ${r.unit}`],['School area',r.location],['Priority',r.priority],['Status',r.status],['Updated',r.updatedLabel]].map(([a,b])=><div className="detail-row" key={a}><span>{a}</span><span>{b}</span></div>)}
 {session.data?.user?.role==='DONOR'?<Form {...offerForm}><form className="offer-form" onSubmit={offerForm.handleSubmit(v=>{setError('');setMessage('');makeOffer.mutate({data:{requestId:r.id,quantity:Number(v.quantity),donorMessage:v.donorMessage||null}},{onSuccess:()=>{setMessage('Your offer is with the teacher for review.');offerForm.reset({quantity:1,donorMessage:''});void client.invalidateQueries({queryKey:getGetRequestsQueryKey()});void client.invalidateQueries({queryKey:getGetSponsorshipsQueryKey()})},onError:e=>setError(e instanceof Error?e.message:'Your offer could not be submitted.')})})}><label className="field">Quantity<input className="auth-input" type="number" min="1" {...offerForm.register('quantity',{valueAsNumber:true,min:1})} data-testid="input-offer-quantity"/></label><label className="field">Message to the teacher <textarea className="auth-input textarea" maxLength={500} {...offerForm.register('donorMessage')} data-testid="input-offer-message"/></label>{error&&<p className="inline-error">{error}</p>}{message&&<p className="inline-success" role="status">{message}</p>}<button className="button button-primary full-button" disabled={makeOffer.isPending} data-testid="button-offer-assistance"><HeartHandshake size={16}/>{makeOffer.isPending?'Sending…':'Offer physical goods'}</button></form></Form>:<Link className="button button-primary full-button" href={session.data?.user?'/donor':'/sign-in'} data-testid="button-offer-assistance">{session.data?.user?'Open donor workspace':'Sign in to offer goods'} <ArrowRight size={15}/></Link>}
  {session.data?.user&&<div className="report-box"><button type="button" className="text-button" onClick={()=>setShowReport(v=>!v)} data-testid="button-report-request">{showReport?'Close report form':'Report a concern about this request'}</button>{showReport&&<Form {...reportForm}><form onSubmit={reportForm.handleSubmit(v=>createReport.mutate({data:{targetType:'REQUEST',targetId:r.id,reason:v.reason,details:v.details||null}},{onSuccess:()=>{setMessage('Thank you. Your report has been received for review.');setShowReport(false);void client.invalidateQueries({queryKey:getGetMyReportsQueryKey()})},onError:e=>setError(e instanceof Error?e.message:'The report could not be sent.')}))}><label className="field">Reason<input className="auth-input" minLength={3} maxLength={120} {...reportForm.register('reason',{required:true})} data-testid="input-report-reason"/></label><label className="field">Additional details<textarea className="auth-input textarea" maxLength={1000} {...reportForm.register('details')} data-testid="input-report-details"/></label><button className="button button-outline" disabled={createReport.isPending} data-testid="button-submit-report">Send report</button></form></Form>}</div>}
  <div className="privacy-note">Goods only. No money transfers, learner accounts, or direct donor-to-learner contact.</div></aside></div></main>
}

export function NotFoundPage(){return <main className="notfound"><div><span className="eyebrow">Page not found</span><h1>Let’s find the right path.</h1><p>The address may be incorrect. Browse published school needs or return to Sedibeng.</p><Link href="/" className="button button-primary">Return home <ArrowRight size={15}/></Link></div></main>}
