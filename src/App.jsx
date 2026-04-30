import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./lib/supabase.js";

/* ============================================================
   下町小僧の意見箱
   匿名で意見を集め、AI(Gemini)が自動グルーピング。
   データ保存先: Supabase
   ============================================================ */

const APP_NAME = "下町小僧の意見箱";
const APP_NAME_EN = "Shitamachi Opinion Box";

export default function VoiceGather() {
  const [view, setView] = useState("home");
  const [boards, setBoards] = useState([]);
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [opinionsByBoard, setOpinionsByBoard] = useState({}); // boardId -> opinions[]
  const [loaded, setLoaded] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [globalError, setGlobalError] = useState("");

  // 初回ロード: ボード一覧を取得
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("boards")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw error;
        setBoards(data || []);
      } catch (e) {
        console.error(e);
        setGlobalError("データベースへの接続に失敗しました。設定をご確認ください。");
      }
      setLoaded(true);
    })();
  }, []);

  // ボード詳細を開いたら、その意見を取得
  useEffect(() => {
    if (!activeBoardId || opinionsByBoard[activeBoardId]) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("opinions")
          .select("*")
          .eq("board_id", activeBoardId)
          .order("created_at", { ascending: false });
        if (error) throw error;
        setOpinionsByBoard((prev) => ({ ...prev, [activeBoardId]: data || [] }));
      } catch (e) {
        console.error(e);
      }
    })();
  }, [activeBoardId]);

  const refreshOpinions = async (boardId) => {
    const { data, error } = await supabase
      .from("opinions")
      .select("*")
      .eq("board_id", boardId)
      .order("created_at", { ascending: false });
    if (!error) {
      setOpinionsByBoard((prev) => ({ ...prev, [boardId]: data || [] }));
    }
  };

  const createBoard = async ({ title, description }) => {
    const newBoard = {
      id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      description,
      groups: null,
    };
    const { data, error } = await supabase
      .from("boards")
      .insert(newBoard)
      .select()
      .single();
    if (error) {
      alert("お題の作成に失敗しました: " + error.message);
      return;
    }
    setBoards((prev) => [data, ...prev]);
    setOpinionsByBoard((prev) => ({ ...prev, [data.id]: [] }));
    setActiveBoardId(data.id);
    setView("board");
  };

  const updateBoard = async (id, patch) => {
    const { data, error } = await supabase
      .from("boards")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      console.error(error);
      return;
    }
    setBoards((prev) => prev.map((b) => (b.id === id ? data : b)));
  };

  const deleteBoard = async (id) => {
    const { error } = await supabase.from("boards").delete().eq("id", id);
    if (error) {
      alert("削除に失敗しました: " + error.message);
      return;
    }
    setBoards((prev) => prev.filter((b) => b.id !== id));
    setOpinionsByBoard((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (activeBoardId === id) {
      setActiveBoardId(null);
      setView("home");
    }
  };

  const requestDeleteBoard = (board) => {
    const count = opinionsByBoard[board.id]?.length ?? 0;
    setConfirmDialog({
      title: "お題を削除しますか?",
      message: `「${board.title}」と、その中で集めた ${count} 件の意見がすべて削除されます。この操作は取り消せません。`,
      confirmLabel: "削除する",
      danger: true,
      onConfirm: async () => {
        await deleteBoard(board.id);
        setConfirmDialog(null);
      },
    });
  };

  const requestDeleteOpinion = (boardId, opinion) => {
    setConfirmDialog({
      title: "この意見を削除しますか?",
      message:
        opinion.text.length > 80
          ? `「${opinion.text.slice(0, 80)}…」を削除します。この操作は取り消せません。`
          : `「${opinion.text}」を削除します。この操作は取り消せません。`,
      confirmLabel: "削除する",
      danger: true,
      onConfirm: async () => {
        const { error } = await supabase
          .from("opinions")
          .delete()
          .eq("id", opinion.id);
        if (error) {
          alert("削除に失敗しました: " + error.message);
          return;
        }
        // ローカル状態更新
        setOpinionsByBoard((prev) => ({
          ...prev,
          [boardId]: (prev[boardId] || []).filter((o) => o.id !== opinion.id),
        }));
        // グルーピングは古くなる → 破棄
        await updateBoard(boardId, { groups: null });
        setConfirmDialog(null);
      },
    });
  };

  const activeBoard = boards.find((b) => b.id === activeBoardId);
  const activeOpinions = opinionsByBoard[activeBoardId] || [];

  return (
    <>
      <GlobalStyles />
      <div className="vg-app">
        <TopNav
          view={view}
          onHome={() => {
            setView("home");
            setActiveBoardId(null);
          }}
          activeBoard={activeBoard}
        />
        <main className="vg-main">
          {globalError && (
            <div className="vg-alert" style={{ marginBottom: 24 }}>
              <AlertIcon /> {globalError}
            </div>
          )}
          {!loaded ? (
            <div className="vg-loading-screen">
              <div className="vg-spinner-lg" />
            </div>
          ) : view === "home" ? (
            <Home
              boards={boards}
              opinionsByBoard={opinionsByBoard}
              onCreate={() => setView("create")}
              onOpen={(id) => {
                setActiveBoardId(id);
                setView("board");
              }}
              onRequestDelete={requestDeleteBoard}
            />
          ) : view === "create" ? (
            <CreateBoard
              onCancel={() => setView("home")}
              onCreate={createBoard}
            />
          ) : view === "board" && activeBoard ? (
            <Board
              board={activeBoard}
              opinions={activeOpinions}
              onUpdate={(patch) => updateBoard(activeBoard.id, patch)}
              onRefresh={() => refreshOpinions(activeBoard.id)}
              onBack={() => setView("home")}
              onRequestDeleteOpinion={(op) => requestDeleteOpinion(activeBoard.id, op)}
            />
          ) : null}
        </main>
        {confirmDialog && (
          <ConfirmDialog
            {...confirmDialog}
            onCancel={() => setConfirmDialog(null)}
          />
        )}
      </div>
    </>
  );
}

/* ---------- Confirm dialog ---------- */
function ConfirmDialog({ title, message, confirmLabel = "OK", cancelLabel = "キャンセル", danger, onConfirm, onCancel }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm, onCancel]);

  return (
    <div className="vg-modal-overlay" onClick={onCancel}>
      <div className="vg-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className={`vg-modal-icon ${danger ? "danger" : ""}`}>
          {danger ? (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M11 7v5M11 15v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M9.7 2.4L1.7 16.6c-.6 1.1.2 2.4 1.4 2.4h16c1.2 0 2-1.3 1.4-2.4L12.3 2.4c-.6-1.1-2-1.1-2.6 0z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 7.5v4M11 14.5v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          )}
        </div>
        <h3 className="vg-modal-title">{title}</h3>
        <p className="vg-modal-message">{message}</p>
        <div className="vg-modal-actions">
          <button ref={cancelRef} className="vg-btn vg-btn-ghost-bordered" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`vg-btn ${danger ? "vg-btn-danger" : "vg-btn-primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Top nav ---------- */
function TopNav({ view, onHome, activeBoard }) {
  return (
    <header className="vg-nav">
      <div className="vg-nav-inner">
        <button className="vg-brand" onClick={onHome} aria-label="Home">
          <span className="vg-brand-mark">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="7" fill="currentColor" opacity="0.18" />
              <circle cx="11" cy="11" r="4" fill="currentColor" />
              <line x1="11" y1="2" x2="11" y2="5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <line x1="11" y1="17" x2="11" y2="20" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </span>
          <span className="vg-brand-name">{APP_NAME}</span>
        </button>

        <nav className="vg-breadcrumbs">
          {view !== "home" && (
            <>
              <button className="vg-crumb-link" onClick={onHome}>お題一覧</button>
              <span className="vg-crumb-sep">/</span>
              <span className="vg-crumb-current">
                {view === "create" ? "新しいお題" : activeBoard?.title || "—"}
              </span>
            </>
          )}
        </nav>

        <div className="vg-nav-right">
          <span className="vg-nav-pill">
            <span className="vg-nav-pill-dot" /> 匿名モード
          </span>
        </div>
      </div>
    </header>
  );
}

/* ---------- Home ---------- */
function Home({ boards, opinionsByBoard, onCreate, onOpen, onRequestDelete }) {
  return (
    <div className="vg-home">
      <section className="vg-hero">
        <div className="vg-hero-eyebrow">{APP_NAME_EN}</div>
        <h1 className="vg-hero-title">
          本音を、そっと集める。<br />
          <span className="vg-hero-accent">傾向は、AIが束ねる。</span>
        </h1>
        <p className="vg-hero-sub">
          匿名でみんなの声を集め、意味の近い意見をAIが自動でグループにまとめます。<br />
          まずはお題を作って、参加者を呼びましょう。
        </p>
        <div className="vg-hero-actions">
          <button className="vg-btn vg-btn-primary vg-btn-lg" onClick={onCreate}>
            <PlusIcon /> 新しいお題を作る
          </button>
          <span className="vg-hero-meta">
            {boards.length === 0 ? "まだお題がありません" : `${boards.length} 件のお題`}
          </span>
        </div>
      </section>

      {boards.length > 0 && (
        <section className="vg-boards">
          <div className="vg-section-row">
            <h2 className="vg-section-h">お題一覧</h2>
            <span className="vg-section-meta">{boards.length} total</span>
          </div>
          <div className="vg-board-grid">
            {boards.map((b) => (
              <BoardCard
                key={b.id}
                board={b}
                opinionCount={opinionsByBoard[b.id]?.length}
                onOpen={() => onOpen(b.id)}
                onDelete={() => onRequestDelete(b)}
              />
            ))}
          </div>
        </section>
      )}

      {boards.length === 0 && (
        <section className="vg-empty-board">
          <div className="vg-empty-illu">
            <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
              <circle cx="40" cy="60" r="20" fill="#FBE9EC" stroke="#9B2335" strokeWidth="1.5" />
              <circle cx="80" cy="40" r="14" fill="#FEF3C7" stroke="#B45309" strokeWidth="1.5" />
              <circle cx="85" cy="80" r="16" fill="#F1E7DA" stroke="#7C5E3C" strokeWidth="1.5" />
              <line x1="56" y1="55" x2="68" y2="44" stroke="#94A3B8" strokeWidth="1" strokeDasharray="2 2" />
              <line x1="58" y1="68" x2="71" y2="78" stroke="#94A3B8" strokeWidth="1" strokeDasharray="2 2" />
            </svg>
          </div>
          <h3 className="vg-empty-h">最初のお題を立ててみましょう</h3>
          <p className="vg-empty-p">
            「次の四半期の優先事項は?」「チームの困りごとは?」など、自由に。
          </p>
        </section>
      )}
    </div>
  );
}

function BoardCard({ board, opinionCount, onOpen, onDelete }) {
  const count = opinionCount; // undefined のときは "—" 表示
  const groupCount = board.groups?.groups?.length || 0;
  return (
    <article className="vg-card-board" onClick={onOpen}>
      <div className="vg-card-top">
        <div className="vg-card-status">
          <span className={`vg-status-dot ${count > 0 ? "active" : ""}`} />
          {count > 0 ? "受付中" : count === 0 ? "意見はまだ" : "—"}
        </div>
        <button
          className="vg-icon-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="お題を削除"
          title="お題を削除"
        >
          <TrashIcon />
        </button>
      </div>
      <h3 className="vg-card-title">{board.title}</h3>
      {board.description && (
        <p className="vg-card-desc">{board.description}</p>
      )}
      <div className="vg-card-stats">
        <div className="vg-stat">
          <div className="vg-stat-num">{count ?? "—"}</div>
          <div className="vg-stat-lbl">意見</div>
        </div>
        <div className="vg-stat">
          <div className="vg-stat-num">{groupCount || "—"}</div>
          <div className="vg-stat-lbl">クラスタ</div>
        </div>
        <div className="vg-stat">
          <div className="vg-stat-num">{relTime(board.created_at)}</div>
          <div className="vg-stat-lbl">作成</div>
        </div>
      </div>
      <div className="vg-card-cta">
        開く <ArrowIcon />
      </div>
    </article>
  );
}

/* ---------- Create board ---------- */
function CreateBoard({ onCancel, onCreate }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const titleRef = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const presets = [
    "次の四半期、私たちが最も力を入れるべきことは?",
    "今のチームで、改善したいプロセスはありますか?",
    "リモートワークで困っていることを教えてください",
    "新しいプロダクトについて、率直なフィードバックを",
  ];

  const submit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    await onCreate({ title: title.trim(), description: description.trim() });
  };

  return (
    <div className="vg-create">
      <div className="vg-create-header">
        <button className="vg-btn-ghost" onClick={onCancel}>
          <BackIcon /> 戻る
        </button>
      </div>

      <div className="vg-create-body">
        <div className="vg-create-eyebrow">Step 1 of 1 · お題を作成</div>
        <h1 className="vg-create-h">お題を作成</h1>
        <p className="vg-create-sub">
          参加者に投げかける問いを書きましょう。明確で答えやすい問いほど、良い意見が集まります。
        </p>

        <div className="vg-form">
          <div className="vg-field">
            <label className="vg-label">
              お題 <span className="vg-required">*</span>
            </label>
            <input
              ref={titleRef}
              className="vg-input vg-input-lg"
              placeholder="例:次の四半期で最も注力すべきことは何だと思いますか?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              maxLength={120}
            />
            <div className="vg-help">{title.length} / 120</div>
          </div>

          <div className="vg-field">
            <label className="vg-label">
              補足説明 <span className="vg-optional">(任意)</span>
            </label>
            <textarea
              className="vg-input vg-textarea"
              placeholder="背景や、特に聞きたい観点があれば。"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
            />
            <div className="vg-help">{description.length} / 300</div>
          </div>

          <div className="vg-field">
            <label className="vg-label-sm">サンプル</label>
            <div className="vg-presets">
              {presets.map((p, i) => (
                <button
                  key={i}
                  className="vg-preset"
                  type="button"
                  onClick={() => setTitle(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="vg-form-footer">
            <button className="vg-btn vg-btn-ghost-bordered" onClick={onCancel}>
              キャンセル
            </button>
            <button
              className="vg-btn vg-btn-primary"
              onClick={submit}
              disabled={!title.trim() || submitting}
            >
              {submitting ? "作成中..." : "お題を作成して意見を集める"}{" "}
              {!submitting && <ArrowIcon />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Board (collect & cluster) ---------- */
function Board({ board, opinions, onUpdate, onRefresh, onBack, onRequestDeleteOpinion }) {
  const [tab, setTab] = useState("collect");
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const groups = board.groups;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  // ボードを開いたら定期的に意見を再取得(他の人の投稿を反映)
  useEffect(() => {
    const id = setInterval(() => {
      if (tab === "collect") onRefresh();
    }, 8000);
    return () => clearInterval(id);
  }, [tab, onRefresh]);

  const submitOpinion = async () => {
    const t = input.trim();
    if (!t || submitting) return;
    setSubmitting(true);
    const newOp = {
      id: `o_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      board_id: board.id,
      text: t,
    };
    const { error } = await supabase.from("opinions").insert(newOp);
    if (error) {
      alert("投稿に失敗しました: " + error.message);
      setSubmitting(false);
      return;
    }
    // グルーピングは古くなる → 破棄
    if (board.groups) await onUpdate({ groups: null });
    await onRefresh();
    setInput("");
    setToast("意見を投稿しました");
    setSubmitting(false);
  };

  const runGrouping = async () => {
    if (opinions.length < 2) {
      setError("グルーピングには2件以上の意見が必要です。");
      return;
    }
    setGrouping(true);
    setError("");
    try {
      const res = await fetch("/api/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: board.title,
          description: board.description || "",
          opinions: opinions.map((o) => ({ text: o.text })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const parsed = await res.json();

      const palette = [
        { bg: "#FBE9EC", fg: "#9B2335", soft: "#F0C4CB" },
        { bg: "#F1E7DA", fg: "#7C5E3C", soft: "#DCC9AB" },
        { bg: "#E8EFE3", fg: "#4F6B3F", soft: "#C9D9C0" },
        { bg: "#F4EAD7", fg: "#A87333", soft: "#E2C896" },
        { bg: "#E5EAF0", fg: "#3F5573", soft: "#C4D0DD" },
        { bg: "#EFE3EE", fg: "#7B3F6B", soft: "#D6BFD2" },
      ];
      const built = (parsed.groups || []).map((g, gi) => ({
        label: g.label || `グループ ${gi + 1}`,
        summary: g.summary || "",
        color: palette[gi % palette.length],
        opinionIds: (g.opinion_indices || [])
          .map((idx) => opinions[idx - 1]?.id)
          .filter(Boolean),
      }));

      const result = { groups: built, generatedAt: Date.now() };
      await onUpdate({ groups: result });
      setTab("clusters");
      setToast(`${built.length} 個のクラスタを生成しました`);
    } catch (e) {
      console.error(e);
      setError("グルーピングに失敗しました。少し時間をおいて再度お試しください。");
    } finally {
      setGrouping(false);
    }
  };

  return (
    <div className="vg-board">
      <div className="vg-board-header">
        <button className="vg-btn-ghost" onClick={onBack}>
          <BackIcon /> お題一覧へ
        </button>

        <div className="vg-board-title-block">
          <div className="vg-board-eyebrow">
            <span className="vg-status-dot active" /> 受付中 · 匿名
          </div>
          <h1 className="vg-board-title">{board.title}</h1>
          {board.description && (
            <p className="vg-board-desc">{board.description}</p>
          )}
        </div>

        <div className="vg-board-stats">
          <div className="vg-bs-item">
            <div className="vg-bs-num">{opinions.length}</div>
            <div className="vg-bs-lbl">意見</div>
          </div>
          <div className="vg-bs-divider" />
          <div className="vg-bs-item">
            <div className="vg-bs-num">{groups?.groups?.length || "—"}</div>
            <div className="vg-bs-lbl">クラスタ</div>
          </div>
          <div className="vg-bs-divider" />
          <div className="vg-bs-item">
            <div className="vg-bs-num">{relTime(board.created_at)}</div>
            <div className="vg-bs-lbl">作成</div>
          </div>
        </div>
      </div>

      <div className="vg-tabs">
        <button
          className={`vg-tab ${tab === "collect" ? "active" : ""}`}
          onClick={() => setTab("collect")}
        >
          意見を集める
          <span className="vg-tab-badge">{opinions.length}</span>
        </button>
        <button
          className={`vg-tab ${tab === "clusters" ? "active" : ""}`}
          onClick={() => groups && setTab("clusters")}
          disabled={!groups}
        >
          クラスタ
          <span className="vg-tab-badge">{groups?.groups?.length || 0}</span>
        </button>
      </div>

      {tab === "collect" && (
        <div className="vg-collect">
          <section className="vg-composer">
            <div className="vg-composer-head">
              <div className="vg-composer-h">あなたの意見</div>
              <div className="vg-anon-chip">
                <LockIcon /> 匿名で送信されます
              </div>
            </div>
            <textarea
              className="vg-composer-ta"
              placeholder="思っていることを自由に書いてください..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitOpinion();
              }}
            />
            <div className="vg-composer-foot">
              <span className="vg-help">
                {input.length} 文字 · ⌘ + Enter で送信
              </span>
              <button
                className="vg-btn vg-btn-primary"
                onClick={submitOpinion}
                disabled={!input.trim() || submitting}
              >
                {submitting ? "送信中..." : "投稿する"}
                {!submitting && <ArrowIcon />}
              </button>
            </div>
          </section>

          <section className="vg-cluster-cta">
            <div>
              <div className="vg-cta-h">AI で意見をまとめる</div>
              <div className="vg-cta-p">
                Gemini が意味の近い意見を自動でグループ化します。
              </div>
            </div>
            <button
              className="vg-btn vg-btn-secondary"
              onClick={runGrouping}
              disabled={grouping || opinions.length < 2}
            >
              {grouping ? (
                <>
                  <span className="vg-spinner" /> 分析中...
                </>
              ) : (
                <>
                  <SparkleIcon /> AI で自動グルーピング
                </>
              )}
            </button>
          </section>

          {error && (
            <div className="vg-alert">
              <AlertIcon /> {error}
            </div>
          )}

          <section className="vg-list-section">
            <div className="vg-section-row">
              <h2 className="vg-section-h">届いた意見</h2>
              <span className="vg-section-meta">
                {opinions.length} 件
              </span>
            </div>

            {opinions.length === 0 ? (
              <div className="vg-empty-list">
                <div className="vg-empty-list-icon">
                  <ChatIcon />
                </div>
                <div className="vg-empty-list-h">まだ意見がありません</div>
                <div className="vg-empty-list-p">
                  最初の意見を上のフォームから投稿してください。
                </div>
              </div>
            ) : (
              <div className="vg-op-grid">
                {opinions.map((o, i) => (
                  <article
                    key={o.id}
                    className="vg-op-card"
                    style={{ animationDelay: `${Math.min(i * 0.04, 0.4)}s` }}
                  >
                    <button
                      className="vg-op-delete"
                      onClick={() => onRequestDeleteOpinion(o)}
                      aria-label="この意見を削除"
                      title="この意見を削除"
                    >
                      <TrashIcon />
                    </button>
                    <div className="vg-op-text">{o.text}</div>
                    <div className="vg-op-meta">
                      <span className="vg-op-id">
                        #{String(opinions.length - i).padStart(3, "0")}
                      </span>
                      <span>{relTime(o.created_at)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "clusters" && groups && (
        <div className="vg-clusters">
          <div className="vg-clusters-intro">
            <div className="vg-clusters-eyebrow">AI Cluster Analysis</div>
            <h2 className="vg-clusters-h">
              {opinions.length} 件から <span>{groups.groups.length} つの傾向</span> が浮かび上がりました
            </h2>
            <div className="vg-clusters-meta">
              生成: {new Date(groups.generatedAt).toLocaleString("ja-JP")}
              <button
                className="vg-btn-ghost vg-btn-ghost-sm"
                onClick={runGrouping}
                disabled={grouping}
              >
                <RefreshIcon /> 再生成
              </button>
            </div>
          </div>

          <div className="vg-cluster-grid">
            {groups.groups.map((g, gi) => {
              const items = g.opinionIds
                .map((id) => opinions.find((o) => o.id === id))
                .filter(Boolean);
              const pct = Math.round((items.length / opinions.length) * 100);
              return (
                <article
                  key={gi}
                  className="vg-cluster"
                  style={{
                    "--cl-bg": g.color.bg,
                    "--cl-fg": g.color.fg,
                    "--cl-soft": g.color.soft,
                    animationDelay: `${gi * 0.06}s`,
                  }}
                >
                  <div className="vg-cluster-head">
                    <div className="vg-cluster-tag">
                      <span className="vg-cluster-dot" />
                      Cluster {String(gi + 1).padStart(2, "0")}
                    </div>
                    <h3 className="vg-cluster-label">{g.label}</h3>
                    <p className="vg-cluster-summary">{g.summary}</p>
                    <div className="vg-cluster-bar">
                      <div className="vg-cluster-bar-fg" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="vg-cluster-bar-meta">
                      <span><strong>{items.length}</strong> 件</span>
                      <span>{pct}%</span>
                    </div>
                  </div>
                  <div className="vg-cluster-items">
                    {items.map((it) => (
                      <div key={it.id} className="vg-cluster-item">
                        {it.text}
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {toast && <div className="vg-toast">{toast}</div>}
    </div>
  );
}

/* ---------- Icons ---------- */
function PlusIcon() { return (<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>); }
function ArrowIcon() { return (<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function BackIcon() { return (<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11 7H3m3.5-3.5L3 7l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function TrashIcon() { return (<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2.5h4V4M3.5 4l.5 7.5h6l.5-7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function LockIcon() { return (<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2.5" y="5.5" width="7" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" /><path d="M4 5.5V3.5a2 2 0 014 0v2" stroke="currentColor" strokeWidth="1.2" /></svg>); }
function SparkleIcon() { return (<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5l1.3 3.2L11.5 6 8.3 7.3 7 10.5 5.7 7.3 2.5 6l3.2-1.3L7 1.5zM11.5 9.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4z" fill="currentColor" /></svg>); }
function AlertIcon() { return (<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" /><path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>); }
function ChatIcon() { return (<svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="4" y="6" width="24" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" /><path d="M10 24l-2 4 6-4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><line x1="10" y1="13" x2="22" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><line x1="10" y1="17" x2="18" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>); }
function RefreshIcon() { return (<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6a4 4 0 016.8-2.8L10 4.5M10 1.5V4.5H7M10 6a4 4 0 01-6.8 2.8L2 7.5M2 10.5V7.5H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>); }

/* ---------- helpers ---------- */
function relTime(ts) {
  if (!ts) return "—";
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return "たった今";
  if (d < 3600) return `${Math.floor(d / 60)}分前`;
  if (d < 86400) return `${Math.floor(d / 3600)}時間前`;
  if (d < 604800) return `${Math.floor(d / 86400)}日前`;
  return new Date(ts).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

/* ---------- Styles ---------- */
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800&family=Noto+Serif+JP:wght@500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
      :root {
        --bg: #FAFAF7; --bg-elev: #FFFFFF; --bg-soft: #F4F2EC; --bg-tint: #F8F6F0;
        --border: #E8E4DA; --border-strong: #D4CEC0;
        --ink: #1A1714; --ink-2: #2D2925; --ink-3: #5A544C; --ink-4: #837C70; --ink-5: #B0A99C;
        --brand: #9B2335; --brand-hover: #82192A; --brand-deep: #6B1422;
        --brand-soft: #FBE9EC; --brand-soft-2: #F4D3D9; --brand-line: #E8B5BE; --brand-tint: #FDF5F6;
        --success: #4F6B3F; --success-soft: #E8EFE3;
        --warning: #B45309; --danger: #B91C1C; --danger-soft: #FEF2F2;
        --radius-sm: 6px; --radius: 10px; --radius-lg: 14px; --radius-xl: 20px;
        --shadow-xs: 0 1px 2px rgba(26,23,20,0.04);
        --shadow-sm: 0 1px 2px rgba(26,23,20,0.04), 0 1px 3px rgba(26,23,20,0.06);
        --shadow-md: 0 4px 6px -1px rgba(26,23,20,0.06), 0 2px 4px -2px rgba(26,23,20,0.04);
        --shadow-lg: 0 10px 15px -3px rgba(26,23,20,0.10), 0 4px 6px -4px rgba(26,23,20,0.06);
        --shadow-brand: 0 4px 14px rgba(155,35,53,0.28);
        --font-sans: 'Plus Jakarta Sans', system-ui, sans-serif;
        --font-jp: 'Noto Serif JP', 'Hiragino Mincho ProN', serif;
        --font-display: 'Inter Tight', system-ui, sans-serif;
        --font-mono: 'JetBrains Mono', monospace;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      .vg-app { font-family: var(--font-sans); background: var(--bg); color: var(--ink); min-height: 100vh; -webkit-font-smoothing: antialiased; font-feature-settings: "cv02","cv03","cv04","cv11"; }
      .vg-nav { position: sticky; top: 0; z-index: 50; background: rgba(250,250,247,0.85); backdrop-filter: saturate(140%) blur(12px); -webkit-backdrop-filter: saturate(140%) blur(12px); border-bottom: 1px solid var(--border); }
      .vg-nav-inner { max-width: 1200px; margin: 0 auto; padding: 0 24px; height: 60px; display: flex; align-items: center; gap: 20px; }
      .vg-brand { display: inline-flex; align-items: center; gap: 10px; background: none; border: none; padding: 0; cursor: pointer; }
      .vg-brand-mark { width: 32px; height: 32px; display: inline-grid; place-items: center; background: var(--brand); color: #FBE9EC; border-radius: var(--radius-sm); box-shadow: 0 1px 0 rgba(255,255,255,0.2) inset, 0 1px 2px rgba(155,35,53,0.2); }
      .vg-brand-name { font-family: var(--font-jp); font-weight: 700; font-size: 18px; letter-spacing: 0.02em; color: var(--ink); }
      .vg-breadcrumbs { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--ink-4); margin-left: 4px; }
      .vg-crumb-link { background: none; border: none; padding: 4px 8px; font-size: 13.5px; color: var(--ink-4); cursor: pointer; border-radius: var(--radius-sm); font-family: inherit; }
      .vg-crumb-link:hover { background: var(--bg-soft); color: var(--ink-2); }
      .vg-crumb-sep { color: var(--ink-5); }
      .vg-crumb-current { color: var(--ink); font-weight: 500; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .vg-nav-right { margin-left: auto; }
      .vg-nav-pill { display: inline-flex; align-items: center; gap: 7px; padding: 5px 12px; background: var(--success-soft); color: var(--success); font-size: 12px; font-weight: 500; border-radius: 999px; border: 1px solid #C9D9C0; }
      .vg-nav-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 3px rgba(79,107,63,0.18); animation: pulseDot 2s infinite; }
      @keyframes pulseDot { 0%, 100% { box-shadow: 0 0 0 3px rgba(79,107,63,0.18); } 50% { box-shadow: 0 0 0 6px rgba(79,107,63,0.06); } }
      .vg-main { max-width: 1200px; margin: 0 auto; padding: 40px 24px 80px; }
      .vg-loading-screen { height: 60vh; display: grid; place-items: center; }
      .vg-spinner-lg { width: 32px; height: 32px; border: 2.5px solid var(--border); border-top-color: var(--brand); border-radius: 50%; animation: spin 0.8s linear infinite; }
      .vg-spinner { width: 14px; height: 14px; border: 1.6px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; display: inline-block; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .vg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 9px 16px; font-family: var(--font-sans); font-weight: 600; font-size: 14px; border: 1px solid transparent; border-radius: var(--radius); cursor: pointer; transition: all 0.15s ease; line-height: 1; letter-spacing: -0.005em; }
      .vg-btn-primary { background: var(--brand); color: #fff; box-shadow: 0 1px 0 rgba(255,255,255,0.15) inset, 0 1px 2px rgba(155,35,53,0.2); }
      .vg-btn-primary:hover:not(:disabled) { background: var(--brand-hover); transform: translateY(-1px); box-shadow: var(--shadow-brand); }
      .vg-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
      .vg-btn-secondary { background: var(--ink); color: #fff; box-shadow: 0 1px 0 rgba(255,255,255,0.1) inset, 0 1px 2px rgba(26,23,20,0.16); }
      .vg-btn-secondary:hover:not(:disabled) { background: var(--ink-2); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(26,23,20,0.2); }
      .vg-btn-secondary:disabled { opacity: 0.45; cursor: not-allowed; }
      .vg-btn-danger { background: var(--danger); color: #fff; box-shadow: 0 1px 0 rgba(255,255,255,0.1) inset, 0 1px 2px rgba(185,28,28,0.2); }
      .vg-btn-danger:hover:not(:disabled) { background: #991B1B; transform: translateY(-1px); box-shadow: 0 4px 14px rgba(185,28,28,0.32); }
      .vg-btn-ghost { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; background: transparent; color: var(--ink-3); border: 1px solid transparent; border-radius: var(--radius); font-family: var(--font-sans); font-weight: 500; font-size: 13.5px; cursor: pointer; transition: all 0.15s; }
      .vg-btn-ghost:hover { background: var(--bg-soft); color: var(--ink); }
      .vg-btn-ghost-sm { font-size: 12px; padding: 5px 10px; }
      .vg-btn-ghost-bordered { background: var(--bg-elev); color: var(--ink-2); border: 1px solid var(--border); }
      .vg-btn-ghost-bordered:hover { background: var(--bg-soft); border-color: var(--border-strong); }
      .vg-btn-lg { padding: 12px 22px; font-size: 15px; border-radius: var(--radius-lg); }
      .vg-icon-btn { width: 28px; height: 28px; display: inline-grid; place-items: center; background: transparent; border: none; border-radius: var(--radius-sm); cursor: pointer; color: var(--ink-4); transition: all 0.15s; }
      .vg-icon-btn:hover { background: var(--danger-soft); color: var(--danger); }
      .vg-home { display: flex; flex-direction: column; gap: 64px; }
      .vg-hero { padding: 64px 0 8px; position: relative; }
      .vg-hero::before { content: ""; position: absolute; top: 40px; right: 0; width: 240px; height: 240px; background: radial-gradient(circle, rgba(155,35,53,0.08) 0%, transparent 70%); pointer-events: none; z-index: 0; }
      .vg-hero > * { position: relative; z-index: 1; }
      .vg-hero-eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--brand); font-weight: 500; margin-bottom: 16px; }
      .vg-hero-title { font-family: var(--font-jp); font-size: clamp(34px, 5vw, 56px); font-weight: 700; letter-spacing: -0.01em; line-height: 1.25; margin: 0 0 20px; }
      .vg-hero-accent { background: linear-gradient(120deg, var(--brand-deep) 0%, var(--brand) 60%, #C84B5B 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
      .vg-hero-sub { font-size: 16px; line-height: 1.85; color: var(--ink-3); max-width: 580px; margin: 0 0 32px; }
      .vg-hero-actions { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
      .vg-hero-meta { font-size: 13px; color: var(--ink-4); font-family: var(--font-mono); }
      .vg-section-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 20px; }
      .vg-section-h { font-family: var(--font-jp); font-size: 22px; font-weight: 700; letter-spacing: 0.01em; margin: 0; }
      .vg-section-meta { font-family: var(--font-mono); font-size: 12px; color: var(--ink-4); letter-spacing: 0.03em; }
      .vg-board-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
      .vg-card-board { position: relative; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 22px 22px 18px; cursor: pointer; transition: all 0.2s ease; display: flex; flex-direction: column; box-shadow: var(--shadow-xs); overflow: hidden; }
      .vg-card-board::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--brand); opacity: 0; transition: opacity 0.2s; }
      .vg-card-board:hover::before { opacity: 1; }
      .vg-card-board:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow-md); }
      .vg-card-board:hover .vg-card-cta { color: var(--brand); }
      .vg-card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
      .vg-card-status { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-4); letter-spacing: 0.04em; }
      .vg-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-5); }
      .vg-status-dot.active { background: var(--brand); box-shadow: 0 0 0 3px rgba(155,35,53,0.18); }
      .vg-card-title { font-family: var(--font-jp); font-size: 18px; font-weight: 700; line-height: 1.5; letter-spacing: 0.005em; color: var(--ink); margin: 0 0 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .vg-card-desc { font-size: 13.5px; line-height: 1.6; color: var(--ink-4); margin: 0 0 18px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .vg-card-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 14px 0 16px; margin-top: auto; border-top: 1px solid var(--border); }
      .vg-stat { text-align: left; }
      .vg-stat-num { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--ink); line-height: 1; letter-spacing: -0.02em; }
      .vg-stat-lbl { font-family: var(--font-mono); font-size: 10px; color: var(--ink-4); margin-top: 4px; letter-spacing: 0.04em; text-transform: uppercase; }
      .vg-card-cta { font-size: 13px; font-weight: 600; color: var(--ink-3); display: inline-flex; align-items: center; gap: 6px; transition: color 0.15s; }
      .vg-empty-board { background: var(--bg-elev); border: 1px dashed var(--border-strong); border-radius: var(--radius-xl); padding: 56px 24px; text-align: center; }
      .vg-empty-illu { margin-bottom: 14px; }
      .vg-empty-h { font-family: var(--font-jp); font-size: 19px; font-weight: 700; margin: 0 0 6px; letter-spacing: 0.005em; }
      .vg-empty-p { font-size: 14px; color: var(--ink-4); margin: 0; }
      .vg-create-header { padding: 8px 0 24px; }
      .vg-create-body { max-width: 680px; margin: 0 auto; padding: 28px 0 80px; }
      .vg-create-eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--brand); font-weight: 500; margin-bottom: 12px; }
      .vg-create-h { font-family: var(--font-jp); font-size: 36px; font-weight: 700; letter-spacing: 0.005em; margin: 0 0 10px; }
      .vg-create-sub { font-size: 15px; line-height: 1.7; color: var(--ink-3); margin: 0 0 36px; }
      .vg-form { display: flex; flex-direction: column; gap: 24px; }
      .vg-field { display: flex; flex-direction: column; gap: 8px; }
      .vg-label { font-size: 13px; font-weight: 600; color: var(--ink-2); letter-spacing: -0.005em; }
      .vg-label-sm { font-family: var(--font-mono); font-size: 11px; color: var(--ink-4); letter-spacing: 0.06em; text-transform: uppercase; }
      .vg-required { color: var(--danger); }
      .vg-optional { color: var(--ink-5); font-weight: 400; }
      .vg-input { width: 100%; padding: 11px 14px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius); font-family: var(--font-sans); font-size: 14.5px; color: var(--ink); line-height: 1.5; transition: border-color 0.15s, box-shadow 0.15s; outline: none; }
      .vg-input:hover { border-color: var(--border-strong); }
      .vg-input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(155,35,53,0.12); }
      .vg-input-lg { font-size: 17px; padding: 14px 16px; font-weight: 500; }
      .vg-textarea { resize: vertical; min-height: 80px; }
      .vg-help { font-family: var(--font-mono); font-size: 11px; color: var(--ink-4); letter-spacing: 0.02em; }
      .vg-presets { display: flex; flex-wrap: wrap; gap: 8px; }
      .vg-preset { padding: 7px 12px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 999px; font-family: inherit; font-size: 12.5px; color: var(--ink-3); cursor: pointer; transition: all 0.15s; }
      .vg-preset:hover { background: var(--brand-soft); border-color: var(--brand-line); color: var(--brand-deep); }
      .vg-form-footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 12px; padding-top: 24px; border-top: 1px solid var(--border); }
      .vg-board-header { padding: 0 0 28px; border-bottom: 1px solid var(--border); }
      .vg-board-title-block { padding: 12px 0 22px; max-width: 760px; }
      .vg-board-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-4); letter-spacing: 0.06em; margin-bottom: 14px; }
      .vg-board-title { font-family: var(--font-jp); font-size: clamp(26px, 3.2vw, 36px); font-weight: 700; line-height: 1.4; letter-spacing: 0.005em; margin: 0 0 10px; }
      .vg-board-desc { font-size: 15px; line-height: 1.75; color: var(--ink-3); margin: 0; }
      .vg-board-stats { display: flex; align-items: center; gap: 28px; padding: 18px 24px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); max-width: max-content; box-shadow: var(--shadow-xs); }
      .vg-bs-num { font-family: var(--font-display); font-size: 22px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
      .vg-bs-lbl { font-family: var(--font-mono); font-size: 10px; color: var(--ink-4); letter-spacing: 0.06em; text-transform: uppercase; margin-top: 5px; }
      .vg-bs-divider { width: 1px; height: 32px; background: var(--border); }
      .vg-tabs { display: flex; gap: 4px; padding: 6px; margin: 28px 0 24px; background: var(--bg-soft); border-radius: var(--radius); max-width: max-content; }
      .vg-tab { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background: transparent; border: none; font-family: var(--font-sans); font-size: 13.5px; font-weight: 500; color: var(--ink-4); cursor: pointer; border-radius: 7px; transition: all 0.15s; }
      .vg-tab:hover:not(:disabled):not(.active) { color: var(--ink-2); }
      .vg-tab.active { background: var(--bg-elev); color: var(--ink); box-shadow: var(--shadow-xs); }
      .vg-tab:disabled { opacity: 0.5; cursor: not-allowed; }
      .vg-tab-badge { font-family: var(--font-mono); font-size: 10.5px; padding: 2px 6px; background: var(--bg-soft); border-radius: 4px; color: var(--ink-4); }
      .vg-tab.active .vg-tab-badge { background: var(--brand-soft); color: var(--brand); }
      .vg-collect { display: flex; flex-direction: column; gap: 24px; }
      .vg-composer { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px 22px; box-shadow: var(--shadow-sm); }
      .vg-composer-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .vg-composer-h { font-family: var(--font-jp); font-weight: 700; font-size: 15px; letter-spacing: 0.01em; }
      .vg-anon-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: var(--bg-soft); border-radius: 999px; font-size: 11.5px; color: var(--ink-3); font-weight: 500; }
      .vg-composer-ta { width: 100%; min-height: 96px; font-family: var(--font-sans); font-size: 15px; line-height: 1.75; color: var(--ink); background: transparent; border: none; outline: none; resize: vertical; }
      .vg-composer-ta::placeholder { color: var(--ink-5); }
      .vg-composer-foot { display: flex; justify-content: space-between; align-items: center; padding-top: 12px; margin-top: 8px; border-top: 1px solid var(--border); }
      .vg-cluster-cta { display: flex; justify-content: space-between; align-items: center; gap: 18px; flex-wrap: wrap; padding: 20px 24px; background: linear-gradient(135deg, var(--brand-tint) 0%, var(--brand-soft) 100%); border: 1px solid var(--brand-line); border-radius: var(--radius-lg); position: relative; overflow: hidden; }
      .vg-cluster-cta::before { content: ""; position: absolute; top: -40px; right: -40px; width: 140px; height: 140px; background: radial-gradient(circle, rgba(155,35,53,0.12) 0%, transparent 70%); pointer-events: none; }
      .vg-cluster-cta > * { position: relative; }
      .vg-cta-h { font-family: var(--font-jp); font-weight: 700; font-size: 15px; letter-spacing: 0.01em; margin-bottom: 4px; color: var(--ink); }
      .vg-cta-p { font-size: 13px; color: var(--ink-3); }
      .vg-alert { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--danger-soft); border: 1px solid #FECACA; border-radius: var(--radius); color: var(--danger); font-size: 13.5px; }
      .vg-list-section { margin-top: 8px; }
      .vg-op-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
      .vg-op-card { position: relative; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px 18px; display: flex; flex-direction: column; animation: cardIn 0.4s ease-out backwards; transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s; }
      .vg-op-card:hover { border-color: var(--border-strong); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
      .vg-op-card:hover .vg-op-delete { opacity: 1; }
      .vg-op-delete { position: absolute; top: 10px; right: 10px; width: 26px; height: 26px; display: inline-grid; place-items: center; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; color: var(--ink-4); opacity: 0; transition: all 0.15s; z-index: 2; }
      .vg-op-delete:hover { background: var(--danger-soft); border-color: #FECACA; color: var(--danger); }
      .vg-op-text { font-size: 14.5px; line-height: 1.75; color: var(--ink); white-space: pre-wrap; word-break: break-word; flex: 1; padding-right: 28px; }
      .vg-op-meta { display: flex; justify-content: space-between; margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border); font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-4); letter-spacing: 0.04em; }
      .vg-op-id { color: var(--brand); font-weight: 600; }
      @keyframes cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      .vg-empty-list { background: var(--bg-elev); border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); padding: 56px 24px; text-align: center; }
      .vg-empty-list-icon { color: var(--ink-5); margin-bottom: 12px; display: inline-grid; place-items: center; }
      .vg-empty-list-h { font-family: var(--font-jp); font-weight: 700; font-size: 16px; letter-spacing: 0.005em; margin-bottom: 6px; }
      .vg-empty-list-p { font-size: 13.5px; color: var(--ink-4); }
      .vg-clusters-intro { margin-bottom: 28px; }
      .vg-clusters-eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--brand); font-weight: 500; margin-bottom: 14px; }
      .vg-clusters-h { font-family: var(--font-jp); font-size: clamp(22px, 2.8vw, 30px); font-weight: 700; letter-spacing: 0.005em; line-height: 1.5; margin: 0 0 14px; }
      .vg-clusters-h span { background: linear-gradient(120deg, var(--brand-deep) 0%, var(--brand) 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
      .vg-clusters-meta { display: flex; align-items: center; gap: 12px; font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-4); letter-spacing: 0.02em; }
      .vg-cluster-grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); }
      .vg-cluster { background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; animation: cardIn 0.45s ease-out backwards; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; }
      .vg-cluster-head { padding: 22px 22px 18px; background: var(--cl-bg); border-bottom: 1px solid var(--cl-soft); }
      .vg-cluster-tag { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10.5px; font-weight: 500; letter-spacing: 0.06em; color: var(--cl-fg); margin-bottom: 8px; }
      .vg-cluster-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--cl-fg); }
      .vg-cluster-label { font-family: var(--font-jp); font-size: 19px; font-weight: 700; letter-spacing: 0.005em; line-height: 1.5; color: var(--ink); margin: 0 0 8px; }
      .vg-cluster-summary { font-size: 13.5px; line-height: 1.7; color: var(--ink-3); margin: 0 0 16px; }
      .vg-cluster-bar { width: 100%; height: 6px; background: rgba(255,255,255,0.6); border-radius: 999px; overflow: hidden; }
      .vg-cluster-bar-fg { height: 100%; background: var(--cl-fg); border-radius: 999px; transition: width 0.6s ease; }
      .vg-cluster-bar-meta { display: flex; justify-content: space-between; margin-top: 6px; font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); letter-spacing: 0.02em; }
      .vg-cluster-bar-meta strong { color: var(--ink); font-weight: 600; }
      .vg-cluster-items { padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
      .vg-cluster-item { padding: 12px 14px; background: var(--bg-tint); border-left: 2px solid var(--cl-fg); border-radius: 4px; font-size: 13.5px; line-height: 1.75; color: var(--ink-2); white-space: pre-wrap; word-break: break-word; }
      .vg-modal-overlay { position: fixed; inset: 0; background: rgba(26,23,20,0.45); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); z-index: 200; display: grid; place-items: center; padding: 20px; animation: overlayIn 0.18s ease-out; }
      @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }
      .vg-modal { background: var(--bg-elev); border-radius: var(--radius-lg); padding: 28px 28px 22px; max-width: 440px; width: 100%; box-shadow: 0 25px 50px -12px rgba(26,23,20,0.25), 0 0 0 1px var(--border); animation: modalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
      @keyframes modalIn { from { opacity: 0; transform: translateY(16px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .vg-modal-icon { width: 44px; height: 44px; display: inline-grid; place-items: center; background: var(--bg-soft); color: var(--ink-3); border-radius: 50%; margin-bottom: 14px; }
      .vg-modal-icon.danger { background: var(--danger-soft); color: var(--danger); }
      .vg-modal-title { font-family: var(--font-jp); font-size: 18px; font-weight: 700; letter-spacing: 0.01em; line-height: 1.4; color: var(--ink); margin: 0 0 8px; }
      .vg-modal-message { font-size: 14px; line-height: 1.75; color: var(--ink-3); margin: 0 0 20px; }
      .vg-modal-actions { display: flex; gap: 10px; justify-content: flex-end; padding-top: 4px; }
      .vg-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); padding: 11px 18px; background: var(--ink); color: #fff; font-size: 13.5px; font-weight: 500; border-radius: var(--radius); box-shadow: var(--shadow-lg); z-index: 100; animation: toastIn 0.3s ease-out; }
      @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
    `}</style>
  );
}
