"use client"

import { useEffect } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import Link from "@tiptap/extension-link"
import Image from "@tiptap/extension-image"
import Placeholder from "@tiptap/extension-placeholder"
import CharacterCount from "@tiptap/extension-character-count"
import { Table } from "@tiptap/extension-table"
import TableCell from "@tiptap/extension-table-cell"
import TableHeader from "@tiptap/extension-table-header"
import TableRow from "@tiptap/extension-table-row"
import Youtube from "@tiptap/extension-youtube"
import TextAlign from "@tiptap/extension-text-align"
import { Bold, Code2, Heading1, Heading2, ImageIcon, Italic, LinkIcon, List, ListOrdered, Quote, TableIcon, UnderlineIcon, YoutubeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { readJsonResponse } from "@/lib/client/safe-json"

export function CmsEditor({
  value,
  onChange,
}: {
  value: { json: unknown; html: string; markdown: string }
  onChange: (value: { json: unknown; html: string; markdown: string }) => void
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      Placeholder.configure({ placeholder: "Write the article..." }),
      CharacterCount,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Youtube.configure({ controls: true, nocookie: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value.html || "<p></p>",
    editorProps: {
      attributes: {
        class: "cms-editor-content min-h-[420px] rounded-lg border border-border/40 bg-[rgba(15,23,42,0.88)] p-4 text-white outline-none",
      },
    },
    onUpdate({ editor }) {
      const html = editor.getHTML()
      onChange({ json: editor.getJSON(), html, markdown: htmlToMarkdown(html) })
    },
  })

  useEffect(() => {
    if (!editor || !value.html || editor.getHTML() === value.html) return
    editor.commands.setContent(value.html)
  }, [editor, value.html])

  if (!editor) return null

  async function addImage() {
    const activeEditor = editor
    if (!activeEditor) return
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "image/*"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const form = new FormData()
      form.set("file", file)
      form.set("altText", file.name)
      const res = await fetch("/api/admin/cms/media", { method: "POST", body: form })
      const data = await readJsonResponse<any>(res).catch(() => ({}))
      if (res.ok && data.asset?.publicUrl) activeEditor.chain().focus().setImage({ src: data.asset.publicUrl, alt: data.asset.altText || "" }).run()
    }
    input.click()
  }

  function addLink() {
    const url = window.prompt("URL")
    if (!url) return
    editor?.chain().focus().setLink({ href: url }).run()
  }

  function addYoutube() {
    const src = window.prompt("YouTube URL")
    if (!src) return
    editor?.commands.setYoutubeVideo({ src, width: 640, height: 360 })
  }

  function addEmoji() {
    editor?.chain().focus().insertContent("😊").run()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 rounded-lg border border-border/40 bg-background/40 p-2">
        <Tool onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} icon={<Bold className="h-4 w-4" />} label="Bold" />
        <Tool onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} icon={<Italic className="h-4 w-4" />} label="Italic" />
        <Tool onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} icon={<UnderlineIcon className="h-4 w-4" />} label="Underline" />
        <Tool onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} icon={<Heading1 className="h-4 w-4" />} label="Heading 1" />
        <Tool onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} icon={<Heading2 className="h-4 w-4" />} label="Heading 2" />
        <Tool onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} icon={<List className="h-4 w-4" />} label="Bullets" />
        <Tool onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} icon={<ListOrdered className="h-4 w-4" />} label="Numbered list" />
        <Tool onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} icon={<Quote className="h-4 w-4" />} label="Quote" />
        <Tool onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} icon={<Code2 className="h-4 w-4" />} label="Code block" />
        <Tool onClick={addLink} active={editor.isActive("link")} icon={<LinkIcon className="h-4 w-4" />} label="Link" />
        <Tool onClick={addImage} icon={<ImageIcon className="h-4 w-4" />} label="Image" />
        <Tool onClick={addYoutube} icon={<YoutubeIcon className="h-4 w-4" />} label="YouTube" />
        <Tool onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} icon={<TableIcon className="h-4 w-4" />} label="Table" />
        <Button type="button" size="icon" variant="outline" title="Emoji" onClick={addEmoji}>😊</Button>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

function Tool({ onClick, active, icon, label }: { onClick: () => void; active?: boolean; icon: React.ReactNode; label: string }) {
  return <Button type="button" size="icon" variant={active ? "default" : "outline"} title={label} onClick={onClick}>{icon}</Button>
}

function htmlToMarkdown(html: string) {
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, "> $1\n\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
