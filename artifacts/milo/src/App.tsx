import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, Menu, X } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function HeroMap() {
  return (
    <div className="milo-map" aria-label="An abstract neighbourhood showing friends arriving at one shared destination" data-testid="illustration-shared-destination">
      <svg viewBox="0 0 650 545" role="img" aria-labelledby="map-title map-description">
        <title id="map-title">All roads meet at Milo</title>
        <desc id="map-description">Four dotted routes arrive from different directions at a shared destination in the centre.</desc>
        <path d="M45 110 C145 83 160 193 250 211 S350 195 391 268" fill="none" stroke="#d6e1dc" strokeWidth="2" opacity=".3" />
        <path d="M18 383 C121 356 151 301 213 316 S316 409 391 286" fill="none" stroke="#d6e1dc" strokeWidth="2" opacity=".3" />
        <path d="M540 65 C490 130 511 182 444 229 S411 259 397 277" fill="none" stroke="#d6e1dc" strokeWidth="2" opacity=".3" />
        <path d="M601 435 C540 394 514 342 472 325 S421 302 399 282" fill="none" stroke="#d6e1dc" strokeWidth="2" opacity=".3" />
        <path d="M39 108 C130 91 164 190 247 214 S350 194 391 271" className="milo-route" fill="none" stroke="#e8a26d" strokeWidth="2.5" />
        <path d="M18 383 C117 360 151 300 213 317 S314 406 391 285" className="milo-route" fill="none" stroke="#e8a26d" strokeWidth="2.5" style={{ animationDelay: '-4s' }} />
        <path d="M541 62 C490 130 511 184 445 231 S412 258 397 276" className="milo-route" fill="none" stroke="#e8a26d" strokeWidth="2.5" style={{ animationDelay: '-8s' }} />
        <path d="M604 436 C540 394 514 342 472 325 S421 302 399 282" className="milo-route" fill="none" stroke="#e8a26d" strokeWidth="2.5" style={{ animationDelay: '-12s' }} />
        <path d="M68 53 C170 118 200 68 278 110 S411 113 505 157" fill="none" stroke="#f8f1e2" strokeWidth="1" opacity=".18" />
        <path d="M74 458 C140 430 207 462 262 426 S370 399 472 455" fill="none" stroke="#f8f1e2" strokeWidth="1" opacity=".18" />
        <path d="M97 205 C165 232 191 253 260 249 S384 221 459 244 S530 264 591 220" fill="none" stroke="#f8f1e2" strokeWidth="1" opacity=".18" />
        <g fill="#e8a26d" stroke="#1f3440" strokeWidth="2">
          <circle className="milo-arrival" cx="39" cy="108" r="7" />
          <circle className="milo-arrival" cx="18" cy="383" r="7" />
          <circle className="milo-arrival" cx="541" cy="62" r="7" />
          <circle className="milo-arrival" cx="604" cy="436" r="7" />
        </g>
        <g fill="#f8f1e2" opacity=".56">
          <circle cx="78" cy="102" r="3" />
          <circle cx="101" cy="84" r="3" />
          <circle cx="121" cy="398" r="3" />
          <circle cx="574" cy="82" r="3" />
          <circle cx="568" cy="421" r="3" />
          <circle cx="534" cy="395" r="3" />
        </g>
        <g className="milo-map-label" fill="#f8f1e2" opacity=".6">
          <text x="26" y="88">NORTH SIDE</text>
          <text x="25" y="411">WEST END</text>
          <text x="500" y="39">UPTOWN</text>
          <text x="530" y="461">RIVERSIDE</text>
        </g>
        <g transform="translate(395 278)">
          <circle r="47" fill="#e8a26d" opacity=".16" />
          <circle r="34" fill="#e8a26d" opacity=".22" />
          <circle r="22" fill="#e8a26d" stroke="#f8f1e2" strokeWidth="2" />
          <path d="M-6 -2 L0 -10 L9 -2 L9 9 L-9 9 L-9 -2Z" fill="#1f3440" />
          <path d="M-15 19 C-7 12 7 12 15 19" fill="none" stroke="#1f3440" strokeWidth="2" strokeLinecap="round" />
        </g>
        <g className="milo-map-label" fill="#f8f1e2">
          <text x="364" y="347">SOMEWHERE GOOD</text>
          <text x="372" y="362" opacity=".54">FOR EVERYONE</text>
        </g>
      </svg>
      <div className="milo-map-caption">not the shortest route — the fairest one</div>
    </div>
  );
}

function CreateRoomButton({ onNotice, className = '' }: { onNotice: () => void; className?: string }) {
  return (
    <button className={`milo-primary-button ${className}`} type="button" onClick={onNotice} data-testid="button-create-room">
      Create a room →
    </button>
  );
}

function Home() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notice, setNotice] = useState(false);

  useEffect(() => {
    document.title = 'Milo — The best way to meet your friends.';
    const description = 'Milo helps friend groups figure out where to go, what to do, and what’s fairest for everyone.';
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', description);

    const ogTitle = document.querySelector('meta[property="og:title"]') ?? document.createElement('meta');
    ogTitle.setAttribute('property', 'og:title');
    ogTitle.setAttribute('content', 'Milo — The best way to meet your friends.');
    if (!ogTitle.parentNode) document.head.appendChild(ogTitle);

    const ogDescription = document.querySelector('meta[property="og:description"]') ?? document.createElement('meta');
    ogDescription.setAttribute('property', 'og:description');
    ogDescription.setAttribute('content', description);
    if (!ogDescription.parentNode) document.head.appendChild(ogDescription);
  }, []);

  const showComingSoon = () => setNotice(true);
  const closeMobileMenu = () => setMobileMenuOpen(false);
  const scrollToHow = () => {
    closeMobileMenu();
    document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <main className="milo-page">
      <section className="milo-hero" data-testid="section-hero">
        <div className="milo-hero-grid" aria-hidden="true" />
        <header className="milo-nav milo-container">
          <div className="milo-nav-inner">
            <a className="milo-logo" href="#top" aria-label="Milo home" data-testid="link-milo-home">
              <span className="milo-logo-mark" aria-hidden="true">m</span>
              Milo
            </a>
            <button
              className="milo-menu-toggle"
              type="button"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((open) => !open)}
              data-testid="button-mobile-menu"
            >
              {mobileMenuOpen ? <X size={23} aria-hidden="true" /> : <Menu size={23} aria-hidden="true" />}
            </button>
            <nav className={`milo-nav-links ${mobileMenuOpen ? 'is-open' : ''}`} aria-label="Primary navigation">
              <a href="#how-it-works" onClick={closeMobileMenu} data-testid="link-how-it-works">How it works</a>
              <a href="#about" onClick={closeMobileMenu} data-testid="link-about">About</a>
              <button className="milo-nav-cta" type="button" onClick={showComingSoon} data-testid="button-nav-create-room">Create a room</button>
            </nav>
          </div>
        </header>
        <div className="milo-container milo-hero-layout" id="top">
          <div>
            <div className="milo-kicker">The best way to meet your friends</div>
            <h1>Meet somewhere <em>everyone</em> will love.</h1>
            <p className="milo-hero-copy" data-testid="text-hero-supporting-copy">
              Milo helps you and your friends figure out where to go, what to do, and what’s fairest for everyone.
            </p>
            <div className="milo-actions">
              <CreateRoomButton onNotice={showComingSoon} />
              <button className="milo-text-button" type="button" onClick={scrollToHow} data-testid="button-see-how-it-works">
                See how it works <ArrowDown size={15} aria-hidden="true" />
              </button>
            </div>
            <div className="milo-hero-note"><span className="milo-pulse" aria-hidden="true" />Made for groups with opinions</div>
          </div>
          <HeroMap />
        </div>
      </section>

      <div className="milo-marquee" aria-hidden="true">
        <div className="milo-marquee-track">
          <span>less “whatever works”</span><span>more actually works</span><span>less group-chat sprawl</span><span>more nights out</span>
          <span>less “whatever works”</span><span>more actually works</span><span>less group-chat sprawl</span><span>more nights out</span>
        </div>
      </div>

      <section className="milo-problem" data-testid="section-problem">
        <div className="milo-container milo-problem-layout">
          <div>
            <div className="milo-eyebrow">The group chat, edited</div>
            <h2 className="milo-section-title">Getting everyone to agree is harder than finding a place.</h2>
            <p className="milo-problem-intro">A good plan is not the loudest suggestion. It is the one that makes the whole group feel considered.</p>
          </div>
          <div className="milo-chat-stack" aria-label="Examples of group chat constraints" data-testid="group-chat-snippets">
            <div className="milo-chat-line" data-person="Maya">That’s 45 mins for me 😭</div>
            <div className="milo-chat-line" data-person="Rae">I don’t eat there.</div>
            <div className="milo-chat-line" data-person="Jon">Can we do something cheaper?</div>
            <div className="milo-chat-line" data-person="Sam">I’m only free after 8.</div>
            <span className="milo-chat-asterisk" aria-hidden="true">*</span>
          </div>
        </div>
      </section>

      <section className="milo-how" id="how-it-works" data-testid="section-how-it-works">
        <div className="milo-container">
          <div className="milo-how-header">
            <div>
              <div className="milo-eyebrow">A better way to make a plan</div>
              <h2 className="milo-section-title">Good plans start with listening.</h2>
            </div>
            <p className="milo-how-aside">Three small steps from “what does everyone want?” to “see you there.”</p>
          </div>
          <div className="milo-step-grid">
            <article className="milo-step" data-testid="card-think">
              <div className="milo-step-index">01 / THINK</div>
              <h3>THINK</h3>
              <p>Everyone shares what they want.</p>
            </article>
            <article className="milo-step" data-testid="card-find">
              <div className="milo-step-index">02 / FIND</div>
              <h3>FIND</h3>
              <p>Milo understands preferences and constraints.</p>
            </article>
            <article className="milo-step" data-testid="card-decide">
              <div className="milo-step-index">03 / DECIDE</div>
              <h3>DECIDE</h3>
              <p>Milo finds options that work for everyone.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="milo-about" id="about" data-testid="section-about">
        <div className="milo-container milo-about-layout">
          <div>
            <div className="milo-eyebrow">The Milo point of view</div>
            <blockquote className="milo-about-quote">The best plan is the one nobody has to <em>settle</em> for.</blockquote>
            <p className="milo-about-copy">Milo turns the invisible parts of making plans — distance, budget, timing, dietary needs — into a starting point everyone can see.</p>
          </div>
          <div className="milo-compass" aria-label="A compass-like illustration about finding a shared centre" data-testid="illustration-shared-centre">
            <div className="milo-compass-inner" aria-hidden="true" />
            <div className="milo-compass-pin" aria-hidden="true" />
            <span className="milo-compass-label north">north</span>
            <span className="milo-compass-label east">east</span>
            <span className="milo-compass-label south">south</span>
            <span className="milo-compass-label west">west</span>
          </div>
        </div>
      </section>

      <section className="milo-final" data-testid="section-final-cta">
        <div className="milo-container milo-final-inner">
          <div className="milo-eyebrow">For the next group chat</div>
          <h2>Next time your group says <em>“Where should we go?”</em> Open Milo.</h2>
          <CreateRoomButton onNotice={showComingSoon} />
          <footer className="milo-footer">
            <span>Milo</span>
            <span>Make room for everyone.</span>
            <span>© 2025 Milo</span>
          </footer>
        </div>
      </section>

      {notice && (
        <div className="milo-notice" role="status" data-testid="status-coming-soon">
          Room creation is coming soon. For now, send Milo to the friend who always asks “Where should we go?”
        </div>
      )}
    </main>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;