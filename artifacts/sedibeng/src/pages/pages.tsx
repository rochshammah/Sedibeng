import { useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useGetRequests, useGetRequest, getGetRequestQueryKey, useGetDonorDashboard, useGetTeacherDashboard, useGetAdminDashboard } from '@workspace/api-client-react';
import type { AssistanceRequest, DemoDashboard } from '@workspace/api-client-react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Heart, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DemoTag, ErrorState, LoadingState, PrivacyNote } from '../components/site';
const schoolSupplies = '/images/sedibeng-stationery-kit.jpg';
const learningKit = '/images/sedibeng-backpack-books.jpg';
const classroomReady = '/images/sedibeng-community-preparation.jpg';

export function HomePage() {
  return <main>
    <section className="hero">
      <div>
        <span className="eyebrow" data-testid="text-home-kicker">School essentials, shared with care</span>
        <h1 data-testid="text-home-headline">A little help.<br/><em>A fuller desk.</em></h1>
        <p className="hero-copy">Sedibeng brings teachers’ requests for physical school goods together with people who want to help—quietly, thoughtfully, and with learners’ dignity at the centre.</p>
        <div className="hero-actions">
          <Link href="/requests" className="button button-primary" data-testid="link-explore-requests">Find a way to help <ArrowUpRight size={16}/></Link>
          <Link href="/register/teacher" className="button button-outline" data-testid="link-teacher-start">Register as a teacher</Link>
        </div>
        <div className="hero-note"><span/>Physical goods only <span style={{marginLeft:10}}/>No money transfers <span style={{marginLeft:10}}/>Learners stay private</div>
      </div>
      <div className="hero-visual">
        <img className="hero-image" src={classroomReady} alt="A quiet classroom prepared with school supplies on empty desks" data-testid="img-home-hero"/>
        <div className="hero-stamp">Made for<br/>the next<br/>school day</div>
        <div className="image-caption">Small essentials can make a classroom feel ready.</div>
      </div>
    </section>
    <section className="section" id="how-it-works">
      <div className="section-inner">
        <div className="section-heading"><div><span className="eyebrow">A simple, careful exchange</span><h2>Support that stays close to what a school needs.</h2></div><p>Teachers describe school-level needs. Donors choose physical goods. Sedibeng’s Phase 1 experience is a public demonstration—not a live fulfilment service.</p></div>
        <div className="steps">
          <article className="step"><span className="step-no">01 / TEACHERS</span><h3>Share the school need</h3><p>Teachers can outline useful items, quantities and context without revealing a learner’s identity or circumstances.</p></article>
          <article className="step"><span className="step-no">02 / DONORS</span><h3>Choose goods to give</h3><p>People can browse the catalogue and offer physical school essentials. No money changes hands through the platform.</p></article>
          <article className="step"><span className="step-no">03 / WITH CARE</span><h3>Keep dignity in view</h3><p>There are no learner accounts and no donor-to-learner communication. Trust and fulfilment workflows are not active in this preview.</p></article>
        </div>
      </div>
    </section>
    <section className="story-band">
      <div className="story-content">
        <div><span className="eyebrow" style={{color:'#9fd1bf'}}>The principle behind the platform</span><h2>Help should feel human.<br/>Privacy should feel certain.</h2><p>Sedibeng is designed around educators and school-level needs. The public catalogue keeps personal details out of view, while the act of giving stays tangible.</p></div>
        <div className="story-quote">“Sedibeng go iwa ka tsela”<br/><small style={{font:'500 12px "DM Sans",sans-serif',color:'#becac5'}}>The official Sedibeng slogan</small></div>
      </div>
    </section>
    <section className="section" id="safeguarding">
      <div className="section-inner">
        <div className="section-heading"><div><span className="eyebrow">Safeguarding comes first</span><h2>Support the need. Protect the learner.</h2></div><p>Privacy and dignity guide the design from the beginning. These are product rules, not claims that live verification is already active.</p></div>
        <div className="steps">
          <article className="step"><span className="step-no">01 / PRIVATE</span><h3>No learner accounts</h3><p>Learners never need to sign up, and their names, faces and private circumstances stay out of public requests.</p></article>
          <article className="step"><span className="step-no">02 / SCHOOL-LEVEL</span><h3>General context only</h3><p>Public examples show broad Gaborone areas and school context, never a home address or private teacher notes.</p></article>
          <article className="step"><span className="step-no">03 / TEACHER-LED</span><h3>Approval before allocation</h3><p>Future proposed matches must be reviewed by teachers. Verification, moderation and fulfilment are not active in this preview.</p></article>
        </div>
      </div>
    </section>
    <section className="section" id="smart-match">
      <div className="section-inner">
        <div className="section-heading"><div><span className="eyebrow">A future matching concept</span><h2>Smart Match begins with a teacher’s approval.</h2></div><p>In a later phase, available goods could be compared with school-level requests. No matching or allocation runs in this demonstration.</p></div>
        <div className="match-preview" data-testid="preview-smart-match">
          <div className="match-photo"><img src={learningKit} alt="School backpack and exercise books arranged on a desk" loading="lazy" data-testid="img-smart-match"/></div>
          <div className="match-copy"><DemoTag label="Concept only"/><h3>Available goods meet a clearly described need.</h3><p>A future suggestion would show the item, quantity and general area. A teacher would decide whether it is appropriate before any allocation.</p><div className="match-flow"><span>Goods offered</span><ArrowRight size={16}/><span>Teacher review</span><ArrowRight size={16}/><span>Allocation only after approval</span></div></div>
        </div>
      </div>
    </section>
    <section className="section">
      <div className="section-inner">
        <div className="section-heading"><div><span className="eyebrow">A tangible kind of support</span><h2>Books, pencils, bags—things a classroom can use.</h2></div><p>Browse sample requests from the Phase 1 catalogue. Every item shown here is demonstration content.</p></div>
        <div style={{display:'grid',gridTemplateColumns:'1.2fr .8fr',gap:20,alignItems:'stretch'}}>
          <img src={schoolSupplies} alt="Notebooks, pencils and a school bag arranged on a desk" style={{height:340,width:'100%',objectFit:'cover',borderRadius:'4px 60px 4px 4px'}} data-testid="img-feature-supplies"/>
          <div style={{background:'#e9eee8',padding:'clamp(26px,4vw,48px)',borderRadius:4,display:'flex',flexDirection:'column',justifyContent:'center'}}>
            <span className="eyebrow">Browse with intention</span><h3 style={{font:"500 36px/1.08 'Newsreader',serif",margin:'18px 0 12px'}}>Find one useful thing to bring along.</h3><p style={{fontSize:13,lineHeight:1.75,color:'#66737b',margin:'0 0 25px'}}>No donation amounts. No payment flow. Just physical essentials and a clear explanation of what the example request is for.</p><Link href="/requests" className="button button-dark" style={{alignSelf:'flex-start'}} data-testid="link-view-catalogue">View the catalogue <ArrowRight size={15}/></Link>
          </div>
        </div>
      </div>
    </section>
    <FeaturedRequests />
    <section className="section" id="get-involved">
      <div className="section-inner">
        <div className="section-heading"><div><span className="eyebrow">Two ways to take part</span><h2>Teachers know the need. Donors bring the goods.</h2></div><p>Both pathways are preview screens only. Account setup and request publishing will be connected in a later phase.</p></div>
        <div className="participation-grid">
          <article className="participation-card">
            <span className="step-no">FOR TEACHERS</span><h3>Describe what would help.</h3>
            <p>Future teacher tools will support school-level requests, suggested matches and approval before allocation—without public learner identities.</p>
            <Link href="/register/teacher" className="text-link" data-testid="link-join-as-teacher">Teacher registration preview <ArrowRight size={14}/></Link>
          </article>
          <article className="participation-card">
            <span className="step-no">FOR DONORS</span><h3>Offer physical essentials.</h3>
            <p>Browse sample requests or preview how available goods could be listed. Sedibeng does not transfer money to teachers.</p>
            <Link href="/register/donor" className="text-link" data-testid="link-join-as-donor">Donor registration preview <ArrowRight size={14}/></Link>
          </article>
        </div>
      </div>
    </section>
    <section className="section faq-section" id="faq">
      <div className="section-inner">
        <div className="section-heading"><div><span className="eyebrow">Frequently asked questions</span><h2>Clear answers, with learner dignity in view.</h2></div><p>These answers describe the intended product model. Phase 1 screens are demonstrations, not an active service.</p></div>
        <div className="faq-list">
          <details id="privacy"><summary>Does Sedibeng give money to teachers?</summary><p>No. The platform is for physical school essentials only. It does not transfer money to teachers.</p></details>
          <details><summary>Can donors contact learners directly?</summary><p>No. Learners do not create accounts, and direct donor-to-learner communication is not part of the product.</p></details>
          <details><summary>Are these requests verified and ready to fulfil?</summary><p>No. The current catalogue contains sample demonstration entries. Teacher verification, moderation, matching and fulfilment are future workflows.</p></details>
          <details><summary>How would a suggested match be approved?</summary><p>In the intended flow, teachers review and approve a proposed match before allocation. No such allocation happens in this preview.</p></details>
        </div>
      </div>
    </section>
    <section className="close-cta"><div className="close-cta-inner"><div><span className="eyebrow">Sedibeng Phase 1</span><h2>Useful things, given in a thoughtful way.</h2></div><Link href="/requests" className="button button-primary" data-testid="link-cta-catalogue">See sample requests <ArrowUpRight size={16}/></Link></div></section>
  </main>;
}

function FeaturedRequests() {
  const query = useGetRequests({});
  return <section className="section featured-requests" id="sample-requests">
    <div className="section-inner">
      <div className="section-heading"><div><span className="eyebrow">A first look</span><h2>Sample requests from Gaborone.</h2></div><p>Example entries only—no verification, publication or fulfilment is implied.</p></div>
      {query.isLoading ? <LoadingState label="Loading sample requests"/> : query.isError ? <ErrorState onRetry={()=>void query.refetch()}/> :
        <div className="request-grid">{(query.data ?? []).slice(0,3).map((item,index)=><RequestCard key={item.id} item={item} index={index}/>)}</div>}
      <Link href="/requests" className="text-link featured-link" data-testid="link-all-sample-requests">Browse all sample requests <ArrowRight size={14}/></Link>
    </div>
  </section>;
}

function RequestCard({ item, index }: { item: AssistanceRequest; index: number }) {
  return <article className="request-card" data-testid={`card-request-${item.id}`}>
    <Link href={`/requests/${item.id}`} data-testid={`link-request-image-${item.id}`} aria-label={`View ${item.title}`}>
      <div className="request-image-wrap"><img className="request-image" src={item.imageUrl} alt={item.imageAlt || 'School goods arranged for a demonstration request'} loading={index < 3 ? 'eager' : 'lazy'} data-testid={`img-request-${item.id}`}/><span className="image-pill">{item.category}</span></div>
    </Link>
    <div className="request-content">
      <div className="request-meta"><span>{item.location}</span><span>{item.priority}</span></div>
      <h3 data-testid={`text-request-title-${item.id}`}>{item.title}</h3>
      <p>{item.description}</p>
      <div className="request-footer"><span className="qty">{item.quantity} {item.unit}</span><Link className="text-link" href={`/requests/${item.id}`} data-testid={`link-request-details-${item.id}`}>View request <ArrowUpRight size={14}/></Link></div>
    </div>
  </article>;
}

export function RequestsPage() {
  const [search,setSearch] = useState('');
  const [category,setCategory] = useState('');
  const [priority,setPriority] = useState('');
  const params = useMemo(() => ({search:search || undefined,category:category || undefined,priority:priority || undefined}),[search,category,priority]);
  const query = useGetRequests(params);
  const requests = query.data;
  return <main>
    <div className="page-head"><span className="eyebrow">The school essentials catalogue</span><h1>Requests, with care.</h1><p>Browse sample requests for physical goods. All catalogue entries are demonstration data, not verified needs or live matches.</p><div style={{marginTop:18}}><DemoTag/></div></div>
    <section className="catalog-wrap">
      <div className="catalog-toolbar">
        <label className="searchbox"><Search size={16}/><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search items, schools or categories" aria-label="Search requests" data-testid="input-request-search"/></label>
         <select className="select-control" value={category} onChange={e=>setCategory(e.target.value)} aria-label="Filter by category" data-testid="select-request-category"><option value="">All categories</option><option>School shoes</option><option>Books &amp; stationery</option><option>Bags</option><option>Uniforms</option></select>
        <select className="select-control" value={priority} onChange={e=>setPriority(e.target.value)} aria-label="Filter by priority" data-testid="select-request-priority"><option value="">Any priority</option><option>Essential</option><option>High</option><option>Standard</option></select>
      </div>
      {query.isLoading ? <LoadingState label="Loading sample requests"/> : query.isError ? <ErrorState onRetry={()=>void query.refetch()}/> : requests?.length ? <>
        <p className="result-line" data-testid="text-request-count">{requests.length} demonstration {requests.length===1?'request':'requests'} · no verification or fulfilment implied</p>
        <div className="request-grid">{requests.map((item,index)=><RequestCard key={item.id} item={item} index={index}/>)}</div>
      </> : <div className="state-panel" data-testid="state-empty-requests"><BookOpen size={25}/><h3>No sample requests match</h3><p>Try another search or clear a filter to explore the catalogue.</p><button className="button button-outline" onClick={()=>{setSearch('');setCategory('');setPriority('')}} data-testid="button-clear-filters">Clear filters</button></div>}
    </section>
  </main>;
}

export function RequestDetailPage() {
  const { id } = useParams<{id:string}>();
  const query = useGetRequest(id || '', {query:{enabled:Boolean(id),queryKey:getGetRequestQueryKey(id || '')}});
  const [notice,setNotice] = useState(false);
  if (!id) return <div className="page-head"><ErrorState onRetry={()=>void query.refetch()}/></div>;
  if (query.isLoading) return <div className="page-head"><LoadingState label="Loading the sample request"/></div>;
  if (query.isError || !query.data) return <div className="page-head"><ErrorState onRetry={()=>void query.refetch()}/></div>;
  const request=query.data;
  return <main>
    <div className="page-head" style={{paddingBottom:18}}><Link href="/requests" className="text-link" data-testid="link-back-requests"><ArrowLeft size={14}/>Back to requests</Link></div>
    <div className="detail-layout">
       <div className="detail-main"><img className="detail-photo" src={request.imageUrl} alt={request.imageAlt || 'School goods for a demonstration request'} data-testid="img-request-detail"/><div style={{display:'flex',gap:10,marginTop:22,alignItems:'center',flexWrap:'wrap'}}><DemoTag/><span className="image-pill" style={{position:'static'}}>{request.category}</span></div><h1 data-testid="text-detail-title">{request.title}</h1><p>{request.description}</p><h3 style={{font:"500 25px 'Newsreader',serif",marginTop:30}}>What would be useful</h3><p>{request.specifications}</p><PrivacyNote/></div>
      <aside className="detail-box"><h3>Request overview</h3><div className="detail-row"><span>Item</span><span>{request.item}</span></div><div className="detail-row"><span>Quantity</span><span>{request.quantity} {request.unit}</span></div><div className="detail-row"><span>School area</span><span>{request.location}</span></div><div className="detail-row"><span>Priority</span><span>{request.priority}</span></div><div className="detail-row"><span>Example status</span><span>{request.status}</span></div><div className="detail-row"><span>Last updated</span><span>{request.updatedLabel}</span></div>
        <button className="button button-primary" style={{width:'100%',marginTop:20}} onClick={()=>setNotice(true)} data-testid="button-offer-assistance"><Heart size={15}/>Offer physical goods</button>
        {notice && <div className="preview-alert" role="status" data-testid="notice-offer-not-saved">This is a demonstration action only. Your offer has not been sent, recorded, or matched.</div>}
        <div className="privacy-note">Donors give physical goods only. No money transfers, learner accounts, or direct donor-to-learner contact.</div>
      </aside>
    </div>
  </main>;
}

type AuthKind = 'signin'|'donor'|'teacher'|'forgot'|'reset';
type AuthFieldKey = 'name'|'email'|'password'|'schoolName'|'newPassword'|'confirmPassword';
type AuthValues = {name?:string;email?:string;password?:string;schoolName?:string;newPassword?:string;confirmPassword?:string};
type AuthField = {key:AuthFieldKey;label:string;type:'text'|'email'|'password'};
const authSchemaBase = z.object({
  name:z.string().optional(),
  email:z.string().optional(),
  password:z.string().optional(),
  schoolName:z.string().optional(),
  newPassword:z.string().optional(),
  confirmPassword:z.string().optional(),
});
const authRequiredFields:Record<AuthKind,AuthFieldKey[]> = {
  signin:['email','password'],
  donor:['name','email','password'],
  teacher:['name','email','schoolName','password'],
  forgot:['email'],
  reset:['newPassword','confirmPassword'],
};
const authFieldLabels:Record<AuthFieldKey,string> = {
  name:'Your name',
  email:'Email address',
  password:'Password',
  schoolName:'School name',
  newPassword:'New password',
  confirmPassword:'Confirm new password',
};
function previewAuthSchema(kind:AuthKind) {
  return authSchemaBase.superRefine((values,ctx)=>{
    for (const field of authRequiredFields[kind]) {
      if (!values[field]?.trim()) ctx.addIssue({code:'custom',path:[field],message:`${authFieldLabels[field]} is required.`});
    }
    if (values.email?.trim() && !z.string().email().safeParse(values.email.trim()).success) {
      ctx.addIssue({code:'custom',path:['email'],message:'Enter a valid email address.'});
    }
    const password = kind==='reset' ? values.newPassword : values.password;
    if (password && password.length < 8) {
      ctx.addIssue({code:'custom',path:[kind==='reset'?'newPassword':'password'],message:'Use at least 8 characters.'});
    }
    if (kind==='reset' && values.newPassword && values.confirmPassword && values.newPassword!==values.confirmPassword) {
      ctx.addIssue({code:'custom',path:['confirmPassword'],message:'Passwords do not match.'});
    }
  });
}
const authFields:Record<AuthKind,AuthField[]> = {
  signin:[{key:'email',label:'Email address',type:'email'},{key:'password',label:'Password',type:'password'}],
  donor:[{key:'name',label:'Your name',type:'text'},{key:'email',label:'Email address',type:'email'},{key:'password',label:'Password',type:'password'}],
  teacher:[{key:'name',label:'Your name',type:'text'},{key:'email',label:'School email',type:'email'},{key:'schoolName',label:'School name',type:'text'},{key:'password',label:'Password',type:'password'}],
  forgot:[{key:'email',label:'Email address',type:'email'}],
  reset:[{key:'newPassword',label:'New password',type:'password'},{key:'confirmPassword',label:'Confirm new password',type:'password'}],
};
const authCopy:Record<AuthKind,{title:string;lead:string;button:string;photo:string}> = {
  signin:{title:'Welcome back.',lead:'Sign in to your Sedibeng preview.',button:'Continue to preview',photo:classroomReady},
  donor:{title:'Give something useful.',lead:'Create a donor preview profile to explore a goods-first experience.',button:'Create donor preview',photo:learningKit},
  teacher:{title:'Start with the school need.',lead:'Teacher registration preview for sharing school-level essentials requests.',button:'Create teacher preview',photo:schoolSupplies},
  forgot:{title:'A reset link, in a real product.',lead:'This preview does not send email or process account recovery.',button:'Preview recovery state',photo:classroomReady},
  reset:{title:'Choose a new password.',lead:'Password reset is shown for preview only. No credentials are sent or saved.',button:'Preview password update',photo:learningKit},
};
export function AuthPage({kind}:{kind:AuthKind}) {
  const copy=authCopy[kind];
  const [submitted,setSubmitted]=useState(false);
  const form=useForm<AuthValues>({
    resolver:zodResolver(previewAuthSchema(kind)),
    defaultValues:{name:'',email:'',password:'',schoolName:'',newPassword:'',confirmPassword:''},
  });
  return <main className="auth-page">
    <div className="auth-visual"><img src={copy.photo} alt="School preparations shown as a non-identifying editorial photograph" data-testid="img-auth-context"/><div className="auth-visual-copy"><span className="eyebrow" style={{color:'#b7dacb'}}>Sedibeng Phase 1</span><h2>Every act of care, with dignity.</h2><p>“Sedibeng go iwa ka tsela” — a thoughtful way to give.</p></div></div>
    <div className="auth-form-wrap"><div className="auth-card"><span className="eyebrow">A safe preview</span><h1 data-testid="text-auth-title">{copy.title}</h1><p>{copy.lead}</p><div className="preview-alert" data-testid="notice-auth-preview"><ShieldCheck size={15} style={{display:'inline',verticalAlign:'middle',marginRight:7}}/>Preview only. Authentication is not active. Do not enter real credentials; nothing is sent or persisted.</div>
      <Form {...form}>
      <form noValidate onSubmit={form.handleSubmit(()=>setSubmitted(true))} data-testid="form-preview-auth">
        {authFields[kind].map(field=><FormField key={field.key} control={form.control} name={field.key} render={({field:control})=><FormItem className="field"><FormLabel>{field.label}</FormLabel><FormControl><input {...control} value={control.value??''} className="auth-input" type={field.type} autoComplete="off" placeholder={field.type==='password'?'Preview only':''} data-testid={`input-auth-${field.key}`}/></FormControl><FormMessage/></FormItem>}/>)}
        {kind==='signin' && <div className="auth-links"><span>Preview access only</span><Link href="/forgot-password" data-testid="link-forgot-password">Forgot password?</Link></div>}
        <button className="button button-primary" type="submit" data-testid="button-auth-submit">{copy.button}<ArrowRight size={15}/></button>
      </form>
      </Form>
      {submitted && <div className="preview-alert" role="status" data-testid="notice-auth-not-saved">Nothing was submitted. This page demonstrates the interface only; credentials are not sent or saved.</div>}
      <div className="auth-foot">{kind==='signin'?<>Need a preview role? <Link href="/register/donor" data-testid="link-register-donor">Donor</Link> · <Link href="/register/teacher" data-testid="link-register-teacher">Teacher</Link></>:<>Already viewing Sedibeng? <Link href="/sign-in" data-testid="link-auth-signin">Return to sign in</Link></>}</div>
    </div></div>
  </main>;
}

const roleData = {
  donor:{title:'Donor preview',description:'A sample view of physical-goods giving. Offers are not saved or matched.',use:useGetDonorDashboard,icon:Heart,nav:[['Overview','/dashboard/donor'],['Browse requests','/requests'],['Teacher preview','/dashboard/teacher'],['Admin preview','/dashboard/admin']]},
  teacher:{title:'Teacher preview',description:'A sample view of school-level request management. No request can be created here.',use:useGetTeacherDashboard,icon:BookOpen,nav:[['Overview','/dashboard/teacher'],['Browse requests','/requests'],['Donor preview','/dashboard/donor'],['Admin preview','/dashboard/admin']]},
  admin:{title:'Admin preview',description:'A sample overview of a safeguarding-first catalogue. No moderation or verification actions are live.',use:useGetAdminDashboard,icon:ShieldCheck,nav:[['Overview','/dashboard/admin'],['Browse requests','/requests'],['Teacher preview','/dashboard/teacher'],['Donor preview','/dashboard/donor']]},
} as const;
type Role = keyof typeof roleData;

function DashboardContent({role,data}:{role:Role;data:DemoDashboard}) {
  const config=roleData[role];
  const Icon=config.icon;
  return <main className="dash-layout">
    <aside className="dash-nav"><Link href="/" className="brand" data-testid="dash-brand"><span className="brand-mark">s</span><span>Sedibeng</span></Link><div className="dash-nav-title">Preview workspace</div>{config.nav.map(([label,href])=><Link key={href} href={href} className={href===`/dashboard/${role}`?'active':''} data-testid={`dash-link-${role}-${label.toLowerCase().replaceAll(' ','-')}`}><Icon size={15}/>{label}</Link>)}<div className="dash-nav-title">Public</div><Link href="/requests" data-testid="dash-link-catalogue"><Search size={15}/>Request catalogue</Link><Link href="/sign-in" data-testid="dash-link-signout"><ArrowLeft size={15}/>Exit preview</Link></aside>
    <div className="dash-main">
      <div className="dash-head"><div><h1 data-testid="text-dashboard-title">{config.title}</h1><p>{config.description}</p></div><Link href="/requests" className="button button-primary" data-testid="button-dash-browse">Browse requests <ArrowUpRight size={15}/></Link></div>
      <div className="dash-warning" data-testid="notice-dashboard-demo"><Sparkles size={16}/>Demonstration data — not live. No verification, fulfilment, matching, authentication, or persistence is represented.</div>
      {!data.demonstration && <div className="dash-warning" role="status">This response was not marked as demonstration content. It is shown only as an unverified preview.</div>}
      {data.counts.length ? <section className="stats-grid" aria-label="Demonstration overview">{data.counts.map((count,index)=><article className="stat-card" key={`${count.label}-${index}`} data-testid={`stat-${role}-${index}`}><span>{count.label}</span><strong>{count.value}</strong><small>{count.detail}</small></article>)}</section>:<div className="state-panel" data-testid="state-empty-dashboard-counts"><h3>No preview counts yet</h3><p>This demonstration response does not include any overview values.</p></div>}
      <section className="dash-section"><div className="dash-section-head"><h2>Recent sample activity</h2><DemoTag label="Example records"/></div>
        {data.records.length ? data.records.map((record,index)=><article className="dash-record" key={record.id} data-testid={`record-${role}-${record.id}`}><img src={[schoolSupplies,learningKit,classroomReady,schoolShoes][index%4]} alt="School essentials demonstration record"/><div><h3>{record.title}</h3><p>{record.detail}</p></div><span className="record-status">{record.status}</span></article>) : <div className="dash-empty" data-testid="state-empty-dashboard-records">There are no example records in this response. Nothing is pending or awaiting real action.</div>}
      </section>
      <PrivacyNote/>
    </div>
  </main>;
}

export function DashboardPage({role}:{role:Role}) {
  const query=roleData[role].use();
  if(query.isLoading) return <div className="dash-layout"><LoadingState label="Loading dashboard demonstration"/></div>;
  if(query.isError || !query.data) return <div className="dash-layout"><ErrorState onRetry={()=>void query.refetch()}/></div>;
  return <DashboardContent role={role} data={query.data}/>;
}

export function NotFoundPage() {
  return <main className="notfound"><div><span className="eyebrow">Nothing here yet</span><h1>That page moved.</h1><p style={{color:'#6b777b',lineHeight:1.7,marginBottom:25}}>The address may be incorrect. The catalogue and all preview pages are still easy to find.</p><Link href="/" className="button button-primary" data-testid="link-not-found-home">Return home <ArrowRight size={15}/></Link></div></main>;
}
