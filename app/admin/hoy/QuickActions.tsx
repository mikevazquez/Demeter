"use client";
import { useMemo, useState, useTransition } from "react";
import { createQuickSale, createQuickStudent } from "./quick-actions";

type Student={id:string;fullName:string};
type Product={id:string;name:string;priceMinor:number;currency:string;creditLimit:number|null;validityDays:number|null;unlimited:boolean};

function money(n:number,c:string,locale:string){return new Intl.NumberFormat(locale,{style:"currency",currency:c,maximumFractionDigits:2}).format(n/100)}

export default function QuickActions({canStudents,canSales,students,products,locale,preferredProductByStudent={}}:{canStudents:boolean;canSales:boolean;students:Student[];products:Product[];locale:string;preferredProductByStudent?:Record<string,string>}){
 const [open,setOpen]=useState<null|"menu"|"student"|"sale">(null);
 const [studentId,setStudentId]=useState("");
 const [studentQuery,setStudentQuery]=useState("");
 const [showAllProducts,setShowAllProducts]=useState(false);
 const [productId,setProductId]=useState("");
 const [discountMode,setDiscountMode]=useState("none");
 const [discountValue,setDiscountValue]=useState("");
 const [payment,setPayment]=useState("");
 const [message,setMessage]=useState<{ok:boolean;text:string}|null>(null);
 const [pending,start]=useTransition();
 const product=useMemo(()=>products.find(p=>p.id===productId)||null,[products,productId]);
 const studentMatches=useMemo(()=>{const q=studentQuery.trim().toLocaleLowerCase("es");if(!q)return [];return students.filter(s=>s.fullName.toLocaleLowerCase("es").includes(q)).slice(0,7)},[students,studentQuery]);
 const preferredId=studentId?preferredProductByStudent[studentId]:undefined;
 const primaryProducts=useMemo(()=>{const preferred=products.find(p=>p.id===preferredId);const monthly=products.filter(p=>p.validityDays!==null&&p.validityDays>=28&&p.validityDays<=31&&p.id!==preferredId);return [...(preferred?[preferred]:[]),...monthly]},[products,preferredId]);
 const otherProducts=useMemo(()=>products.filter(p=>!primaryProducts.some(x=>x.id===p.id)),[products,primaryProducts]);
 const discount=useMemo(()=>{if(!product)return 0;if(discountMode==="courtesy")return product.priceMinor;if(discountMode==="percentage")return Math.min(product.priceMinor,Math.round(product.priceMinor*(Number(discountValue)||0)/100));if(discountMode==="amount")return Math.min(product.priceMinor,Math.round((Number(discountValue)||0)*100));return 0},[product,discountMode,discountValue]);
 const total=product?Math.max(product.priceMinor-discount,0):0;
 const close=()=>{setOpen(null);setMessage(null)};
 return <div className="hoy-quick-root">
   <button className="hoy-header-action" type="button" onClick={()=>setOpen(open ? null : "menu")}>Atajos</button>
   {open==="menu"?<div className="hoy-shortcuts-menu hoy-shortcuts-menu-inline">
     {canStudents?<button onClick={()=>{setMessage(null);setOpen("student")}}>Nueva alumna</button>:null}
     {canSales?<button onClick={()=>{setMessage(null);setOpen("sale")}}>Nueva venta</button>:null}
   </div>:null}
   {open==="student"?<div className="hoy-quick-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
    <section className="hoy-quick-card"><header><div><span>Atajo</span><h2>Nueva alumna</h2><p>Nombre y teléfono bastan para crearla.</p></div><button type="button" onClick={close}>×</button></header>
    <form onSubmit={e=>{e.preventDefault();const fd=new FormData(e.currentTarget);start(async()=>{const r=await createQuickStudent(fd);setMessage({ok:r.ok,text:r.message});if(r.ok){(e.currentTarget as HTMLFormElement).reset();setTimeout(close,700)}})}} className="hoy-quick-form">
      <input name="first_name" placeholder="Nombre" required/><input name="last_name" placeholder="Apellido opcional"/><input name="phone" inputMode="tel" placeholder="Teléfono · 10 dígitos" required/><input name="email" type="email" placeholder="Correo opcional"/>
      {message?<p className={message.ok?"quick-success":"quick-error"}>{message.text}</p>:null}<button className="primary-button" disabled={pending}>{pending?"Creando…":"Crear alumna"}</button>
    </form></section></div>:null}
   {open==="sale"?<div className="hoy-quick-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
    <section className="hoy-quick-card hoy-quick-sale"><header><div><span>Atajo</span><h2>Nueva venta</h2><p>Selecciona alumna y paquete. Lo demás se completa automáticamente.</p></div><button type="button" onClick={close}>×</button></header>
    <form onSubmit={e=>{e.preventDefault();const fd=new FormData(e.currentTarget);start(async()=>{const r=await createQuickSale(fd);setMessage({ok:r.ok,text:r.message});if(r.ok)setTimeout(close,850)})}} className="hoy-quick-form">
      <label className="hoy-student-search"><span>Alumna</span><input autoComplete="off" placeholder="Escribe el nombre…" value={studentQuery} onChange={e=>{setStudentQuery(e.target.value);setStudentId("")}} />{studentMatches.length&&!studentId?<div className="hoy-student-results">{studentMatches.map(s=><button type="button" key={s.id} onClick={()=>{setStudentId(s.id);setStudentQuery(s.fullName);setProductId("");setShowAllProducts(false)}}>{s.fullName}</button>)}</div>:null}<input type="hidden" name="student_id" value={studentId}/></label>
      {studentId?<div className="hoy-package-picker"><span>Paquete</span><div className="hoy-package-options">{primaryProducts.map(p=><button type="button" key={p.id} className={productId===p.id?"is-selected":""} onClick={()=>{setProductId(p.id);setPayment("")}}><strong>{p.name}</strong><small>{p.unlimited?"Ilimitado":`${p.creditLimit??0} créditos`}{p.validityDays?` · ${p.validityDays} días`:""}</small>{p.id===preferredId?<em>Habitual</em>:null}</button>)}</div>{otherProducts.length?<button type="button" className="hoy-other-products" onClick={()=>setShowAllProducts(v=>!v)}>{showAllProducts?"Ocultar otros paquetes":"Ver otros paquetes"}</button>:null}{showAllProducts?<div className="hoy-package-options hoy-package-options-other">{otherProducts.map(p=><button type="button" key={p.id} className={productId===p.id?"is-selected":""} onClick={()=>{setProductId(p.id);setPayment("")}}><strong>{p.name}</strong><small>{p.unlimited?"Ilimitado":`${p.creditLimit??0} créditos`}{p.validityDays?` · ${p.validityDays} días`:""}</small></button>)}</div>:null}<input type="hidden" name="product_id" value={productId}/></div>:null>
      {product?<div className="hoy-quick-product"><strong>{product.name}</strong><span>{product.unlimited?"Ilimitado":`${product.creditLimit??0} créditos`}{product.validityDays?` · ${product.validityDays} días`:""}</span><b>{money(product.priceMinor,product.currency,locale)}</b></div>:null}
      {product?<><label><span>Descuento</span><select name="discount_mode" value={discountMode} onChange={e=>{setDiscountMode(e.target.value);setDiscountValue("")}}><option value="none">Sin descuento</option><option value="percentage">Porcentaje</option><option value="amount">Monto</option><option value="courtesy">Cortesía total</option></select></label>
      {discountMode==="percentage"||discountMode==="amount"?<label><span>{discountMode==="percentage"?"Porcentaje":"Monto a descontar"}</span><input name="discount_value" type="number" min="0" step="0.01" value={discountValue} onChange={e=>setDiscountValue(e.target.value)}/></label>:<input type="hidden" name="discount_value" value=""/>}
      {discountMode!=="none"?<label><span>Motivo</span><input name="discount_reason" required placeholder="Ej. promoción"/></label>:<input type="hidden" name="discount_reason" value=""/>}
      <div className="hoy-quick-total"><span>Total</span><strong>{money(total,product.currency,locale)}</strong></div>
      <label><span>Pago recibido</span><div className="hoy-money-row"><input name="payment_amount" type="number" min="0" step="0.01" value={payment} onChange={e=>setPayment(e.target.value)} placeholder="0.00"/><button type="button" onClick={()=>setPayment((total/100).toFixed(2))}>Usar total</button></div></label>
      {Number(payment)>0?<label><span>Cómo pagó</span><select name="payment_method" required defaultValue=""><option value="" disabled>Seleccionar</option><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option></select></label>:<input type="hidden" name="payment_method" value=""/>}</>:null}
      {message?<p className={message.ok?"quick-success":"quick-error"}>{message.text}</p>:null}
      <button className="primary-button" disabled={pending||!studentId||!productId}>{pending?"Registrando…":"Registrar venta"}</button>
    </form></section></div>:null}
 </div>
}