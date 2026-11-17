import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adaptTextareaCSP} from '../../scripts/textarea-csp.mjs';

test('the installed autosize probe remains hidden without setting a forbidden style attribute',async()=>{
  const source=readFileSync(new URL('../../node_modules/@rc-component/input/es/calculateNodeHeight.js',import.meta.url),'utf8');
  const adapted=adaptTextareaCSP(source);
  const previous={document:globalThis.document,window:globalThis.window};
  const properties=new Map();let probe;
  const computed={'box-sizing':'border-box','padding-top':'6px','padding-bottom':'6px','border-top-width':'1px','border-bottom-width':'1px','line-height':'22px','width':'320px'};
  globalThis.document={createElement(){return probe={value:'',scrollHeight:38,setAttribute(name){assert.notEqual(name,'style','strict CSP forbids the style attribute');},removeAttribute(){},style:{setProperty(name,value,priority=''){properties.set(name,{value,priority});}}};},body:{appendChild(){}}};
  globalThis.window={getComputedStyle:()=>({getPropertyValue:name=>computed[name]??'normal'})};
  try{
    const module=await import('data:text/javascript;base64,'+Buffer.from(adapted).toString('base64'));
    const input={getAttribute:()=>null,value:'自己的理解'};
    const result=module.default(input,false,2,6);
    assert.equal(properties.get('visibility').value,'hidden');
    assert.equal(properties.get('position').value,'absolute');
    assert.deepEqual(properties.get('height'),{value:'0',priority:'important'});
    assert.equal(properties.get('width').value,'320px');
    assert.equal(input.value,'自己的理解');
    assert.ok(Number.isFinite(result.height));
    assert.throws(()=>adaptTextareaCSP(source.replace("hiddenTextarea.setAttribute('style'","changed.setAttribute('style'")),/Review/);
  }finally{globalThis.document=previous.document;globalThis.window=previous.window;}
});
